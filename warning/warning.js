document.addEventListener("DOMContentLoaded", function () {
  const params = new URLSearchParams(window.location.search);
  const riskyUrl = params.get("url");

  document.getElementById("go-back").addEventListener("click", function () {
    window.parent.postMessage("redirect", "*"); // Redirect to a safe page
  });

  document.getElementById("proceed").addEventListener("click", function () {
    window.parent.postMessage("close-warning", "*"); // Notify content.js to remove iframe
  });
});
