/* main.js — boot. */
"use strict";

(function () {
  try {
    ATLAS.init();
    UI.start();
  } catch (err) {
    console.error(err);
    var r = document.getElementById("root");
    if (r) r.innerHTML = '<div class="booting">The atlas failed to assemble: ' +
      String(err && err.message ? err.message : err).replace(/</g, "&lt;") + "</div>";
  }
})();
