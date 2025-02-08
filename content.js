async function fetchImageAsBuffer(url) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return blob;
  } catch (error) {
    console.error("Error fetching image:", url, error);
    return null;
  }
}
async function injectWarningPage() {
  const iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL("warning/warning.html");
  iframe.style.position = "fixed";
  iframe.style.top = "0";
  iframe.style.left = "0";
  iframe.style.width = "100vw";
  iframe.style.height = "100vh";
  iframe.style.border = "none";
  iframe.style.zIndex = "999999";

  document.body.appendChild(iframe);

  // Listen for message from iframe to remove it
  window.addEventListener("message", (event) => {
    if (event.data === "close-warning") {
      iframe.remove();
    }
  });
  window.addEventListener("message", (event) => {
    if (event.data === "redirect") {
      window.location.href = "https://www.google.com";
    }
  });
}
async function processImage(blob) {
  const img = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = 300;
  canvas.height = 300;
  ctx.drawImage(img, 0, 0, 300, 300);

  // Convert to grayscale
  const imageData = ctx.getImageData(0, 0, 300, 300);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = gray;
  }
  ctx.putImageData(imageData, 0, 0);

  return new Uint8Array(imageData.data.filter((_, idx) => idx % 4 === 0)); // Extract grayscale channel
}
async function fetchGemini(contents, domain) {
  const GOOGLE_API_KEY = ""; // Replace with your actual API key
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_API_KEY}`;

  const requestData = {
    contents: [
      {
        parts: [
          {
            text: `You have to detect if a website is a phishing website.
Here are the website contents: ${contents}
The URL of the website is: ${domain}

Return the output in strictly this JSON format:

json
Copy
{"detection": true/false, "detectedSite": "", "legit": true/false}
"detection" should be true if you think it is a phishing website; otherwise, false.
"detectedSite" should contain the name of the website being impersonated (e.g., Google, SBI, Facebook).
"legit" should be false if website is a popular or trusted service (such as retail.onlinesbi.sbi, Microsoft, Google, Amazon, Facebook, or Twitter, Paypal) or their subdomains; and true if and only if the site is a real login page and not the front page or home page and the first condition is false, its default value should be false`,
          },
        ],
      },
    ],
    generationConfig: { response_mime_type: "application/json" },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

    const data = await response.json();
    console.log("API Response:", data);
    return data;
  } catch (error) {
    console.error("Error fetching Gemini recipes:", error);
  }
}
async function compareImagesSSIM(imgUrl1, imgUrl2) {
  const [blob1, blob2] = await Promise.all([
    fetchImageAsBuffer(imgUrl1),
    fetchImageAsBuffer(imgUrl2),
  ]);

  if (!blob1 || !blob2) return 0;

  const [imgData1, imgData2] = await Promise.all([
    processImage(blob1),
    processImage(blob2),
  ]);

  const width = 300,
    height = 300;
  const { mssim } = ssim.ssim(
    { data: imgData1, width, height },
    { data: imgData2, width, height }
  );

  return mssim;
}
async function showWarningAlert(
  message = "⚠️ Warning: This website might be unsafe!",
  words
) {
  const alertDiv = document.createElement("div");
  alertDiv.id = "custom-warning-alert";
  alertDiv.innerHTML = `
      <div class="alert-box">
          <h4>
          ${message}
          </h4>
          <p>It got flagged due to: ${words} usage in the page</p>
          <p>Please Proceed With Caution!!</p>
      </div>
      <style>
          .alert-box {
              position: fixed;
              top: 10px;
              left: 50%;
              transform: translateX(-50%);
              background: #e02828;
              color: white;
              padding: 15px 25px;
              font-size: 16px;
              font-weight: bold;
              border-radius: 5px;
              z-index: 9999;
              box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.3);
              opacity: 0;
              animation: fadeIn .5s forwards, fadeOut .5s 7s forwards;
          }

          @keyframes fadeIn {
              from { opacity: 0; transform: translate(-50%, -20px); }
              to { opacity: 1; transform: translate(-50%, 0); }
          }

          @keyframes fadeOut {
              from { opacity: 1; transform: translate(-50%, 0); }
              to { opacity: 0; transform: translate(-50%, -20px); }
          }
      </style>
  `;

  document.body.appendChild(alertDiv);

  // Wait for the total animation time (4s) before removing it
  await new Promise((resolve) => setTimeout(resolve, 8000));
  alertDiv.remove();
}

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === "extractPageContent") {
    console.log("Extracting page content...");

    const pageContent = {
      text: document.body.innerText.toLowerCase(),
      buttons: Array.from(document.querySelectorAll("button"))
        .map((btn) => btn.innerText.toLowerCase())
        .join(" "),
      inputTypes: Array.from(document.querySelectorAll("input"))
        .map((input) => input.type)
        .join(" "),
      inputPlaceholders: Array.from(document.querySelectorAll("input"))
        .map((input) => input.placeholder.toLowerCase())
        .join(" "),
      images: Array.from(document.images).map((img) => img.src),
      favicon: document.querySelector("link[rel~='icon']")?.href || "",
    };

    console.log("Extracted Content:", pageContent);

    const response = await fetch(chrome.runtime.getURL("data.json"));
    const siteData = await response.json();

    let detectedSite = null;
    let maxMatches = 0;
    let matchedKeywords = [];

    for (const site of siteData) {
      let matchCount = 0;
      let tempMatchedKeywords = [];

      // Check keywords in page text
      site.keywords.forEach((keyword) => {
        if (pageContent.text.includes(keyword.toLowerCase())) {
          matchCount++;
          tempMatchedKeywords.push(keyword);
        }
      });

      // Check button text
      site.buttons.forEach((buttonText) => {
        if (pageContent.buttons.includes(buttonText.toLowerCase())) {
          matchCount += 5;
          tempMatchedKeywords.push(buttonText);
        }
      });

      // Check Input types
      site["form-inputs"].forEach((inputType) => {
        if (pageContent.inputTypes.includes(inputType)) {
          matchCount += 5;
          tempMatchedKeywords.push(inputType);
        }
      });

      // Check input placeholder names
      site["form-inputs"].forEach((inputPlaceholder) => {
        if (
          pageContent.inputPlaceholders.includes(inputPlaceholder.toLowerCase())
        ) {
          matchCount += 5;
          tempMatchedKeywords.push(inputPlaceholder);
        }
      });

      if (matchCount > maxMatches) {
        maxMatches = matchCount;
        detectedSite = site;
        matchedKeywords = tempMatchedKeywords;
      }
    }

    if (maxMatches >= 0) {
      // Start Image Detections
      try {
        if (pageContent.favicon && detectedSite.favicon) {
          const similarity = await compareImagesSSIM(
            pageContent.favicon,
            chrome.runtime.getURL(detectedSite.favicon)
          );
          if (similarity > 0.8) {
            maxMatches += 30;
            console.log(`favicon matched: ${similarity} ${detectedSite.name}`);
            matchedKeywords.push("favicon match");
          }
        }

        for (const img of pageContent.images) {
          if (detectedSite.Logo) {
            const similarity = await compareImagesSSIM(
              img,
              chrome.runtime.getURL(detectedSite.Logo)
            );
            if (similarity > 0.8) {
              maxMatches += 30;
              console.log(`logo matched: ${similarity} ${detectedSite.name}`);
              matchedKeywords.push("logo match");
            }
          }
        }
      } catch (err) {
        console.error(`error: ${err}`);
      }

      var res = { detection: false, detectedSite: "", legit: false };
      try {
        const gemDetect = await fetchGemini(
          document.documentElement.innerHTML,
          window.location.href
        );
        console.log(gemDetect);
        res = JSON.parse(
          gemDetect["candidates"][0]["content"]["parts"][0]["text"]
        );
      } catch (err) {
        console.error(err);
      }
      console.log(
        `gem detect: ${res["detection"]} ${res["detectedSite"]}, legit: ${res["legit"]}`
      );

      if ((maxMatches > 60 && res["legit"]) || res["detection"]) {
        await injectWarningPage();
      } else {
        // showWarningAlert(
        //   "⚠️ Warning: This website might be unsafe!",
        //   matchedKeywords.join(", ")
        // );
      }

      console.log(`(Matches: ${maxMatches})`);
      console.log(`Matched Keywords: ${matchedKeywords.join(", ")}`);
    }
  }
});
