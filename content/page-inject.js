// page-inject.js
// Runs in the page's MAIN world (injected via <script src="...">) so it can
// access window.fetch and window.monaco. Communicates with content.js via postMessage.

(function () {
  // 1. Intercept fetch to capture the typed code from submission requests.
  var _fetch = window.fetch;
  window.fetch = function (url, opts) {
    try {
      var u = typeof url === "string" ? url : (url && url.url) || "";
      if (u.indexOf("/submit") !== -1 && opts && opts.body) {
        var d = JSON.parse(opts.body);
        if (d.typed_code) {
          window.postMessage({ type: "LC_NOTES_SUBMITTED_CODE", code: d.typed_code }, window.location.origin);
        }
      }
    } catch (e) {}
    return _fetch.apply(this, arguments);
  };

  // 2. Respond to requests from content.js to read the current Monaco editor value.
  window.addEventListener("message", function (e) {
    // Only accept messages from the same page (not remote frames or extensions).
    if (e.origin !== window.location.origin) return;
    if (!e.data || e.data.type !== "LC_NOTES_GET_CODE") return;
    var code = "";
    try {
      if (window.monaco && window.monaco.editor) {
        var models = window.monaco.editor.getModels();
        if (models.length > 0) code = models[0].getValue();
      }
    } catch (err) {}
    window.postMessage({ type: "LC_NOTES_CODE_RES", code: code }, window.location.origin);
  });
})();
