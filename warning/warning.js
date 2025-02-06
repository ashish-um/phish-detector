document.addEventListener("DOMContentLoaded", function () {
  const params = new URLSearchParams(window.location.search);
  const riskyUrl = params.get("url");

  document.getElementById("go-back").addEventListener("click", function () {
    window.location.href = ""; // Redirect to a safe page
  });

  document.getElementById("proceed").addEventListener("click", function () {
    window.location.href = riskyUrl; // Allow user to proceed
  });
});
