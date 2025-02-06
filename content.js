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

      //Check High Priority Text
      site.main.forEach((keyword) => {
        if (pageContent.text.includes(keyword.toLowerCase())) {
          matchCount += 30;
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

    if (maxMatches >= 3) {
      // Start Image Detections
      if (pageContent.favicon && detectedSite.favicon) {
        const similarity = await compareImagesSSIM(
          pageContent.favicon,
          chrome.runtime.getURL(detectedSite.favicon)
        );
        if (similarity > 0.8) {
          maxMatches += 20;
          console.log(`favicon matched: ${similarity} ${detectedSite.name}`);
          matchedKeywords.push("favicon match");
        }
      }

      try {
        for (const img of pageContent.images) {
          if (detectedSite.Logo) {
            const similarity = await compareImagesSSIM(
              img,
              chrome.runtime.getURL(detectedSite.Logo)
            );
            if (similarity > 0.8) {
              maxMatches += 20;
              console.log(`logo matched: ${similarity} ${detectedSite.name}`);
              matchedKeywords.push("logo match");
            }
          }
        }
      } catch (err) {
        console.error(`error: ${err}`);
      }

      console.log(
        `Potential phishing detected for: ${detectedSite.name} (Matches: ${maxMatches})`
      );
      console.log(`Matched Keywords: ${matchedKeywords.join(", ")}`);
    }
  }
});
