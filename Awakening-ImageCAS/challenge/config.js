/* Deployment settings of the Ostia Challenge.
 *   MODE "local"  : no server. Uses ../_workbench/challenge-data/ if it exists (real slices + truth.json), otherwise a synthetic demo.
 *   MODE "remote" : Altervista. API_BASE is the url of api.php, DATA_BASE the folder that holds the slice folders (one per case token).
 * Leaderboard and cooldown (local mode) are kept in the browser only.
 * Override without editing: open the page with ?mode=local (real data from _workbench, local leaderboard) or ?mode=remote. */
window.OSTIA_CONFIG = {
    MODE: "remote",
    // https (not http): the page is served over https, browsers block calls to http addresses from it
    API_BASE: "https://shapire.altervista.org/AwakeningImageCAS-challenge/api.php",
    DATA_BASE: "https://shapire.altervista.org/AwakeningImageCAS-challenge/slices/",
    LOCAL_DATA_BASE: "../_workbench/challenge-data/",
    COOLDOWN_SECONDS: 300
};
(function () {
    var m = /[?&]mode=(local|remote)\b/.exec(location.search);
    if (m) window.OSTIA_CONFIG.MODE = m[1];
})();
