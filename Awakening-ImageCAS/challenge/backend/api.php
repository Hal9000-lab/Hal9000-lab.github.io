<?php
/*
 * Ostia Challenge: tiny backend, plain PHP + flat files (no database).
 *
 * Layout on the server (all inside one folder, e.g. https://<site>.altervista.org/ostia/):
 *   api.php               this file
 *   data/                 private files, created/filled by the script (needs to be writable); contains truth.php (you upload it)
 *   slices/<token>/...    the PNG stacks + meta.json exported by export_challenge.py
 *
 * Every private file is a .php file whose first line is a PHP "exit" statement (see GUARD below), so the web server never shows its content.
 * Requests: POST api.php?action=<init|start|submit|finish|leaderboard> with a JSON body (sent as text/plain, so no CORS preflight).
 * Answers are always HTTP 200 with a JSON body; failures are {"error": "..."} (+ "cooldown": seconds when relevant).
 */

// ------------------------------------------------------------------ settings
$ALLOWED_ORIGINS = array(
    'https://hal9000-lab.github.io',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://localhost:8792',
);
$SALT            = 'CHANGE-ME-to-any-long-random-string';   // used to hash client ids and IPs (never stored in clear)
$COOLDOWN        = 300;                                      // seconds between two completed runs of the same client
$N_SCORED        = 12;                                       // scored cases of a run
$N_ALCAPA        = 3;                                        // unscored special cases of a run
$MAX_TRIALS      = 5000;                                     // leaderboard rows kept in the answer
$MAX_STARTS_HOUR = 30;                                       // new runs per hour and per IP
$DEV_NICK        = '§§_§§';                                  // this exact nickname is the developer test user: its trials are listed on the leaderboard for $DEV_VISIBLE seconds only
$DEV_VISIBLE     = 300;

// ------------------------------------------------------------------ helpers
define('GUARD', '<' . '?php exit; ?' . ">\n");
if (!function_exists('mb_substr')) { function mb_substr($s, $a, $l = null, $e = null) { return $l === null ? substr($s, $a) : substr($s, $a, $l); } }
if (!function_exists('mb_strtolower')) { function mb_strtolower($s, $e = null) { return strtolower($s); } }
if (!function_exists('intdiv')) { function intdiv($a, $b) { return (int)floor($a / $b); } }
if (!function_exists('random_bytes')) { function random_bytes($n) { $o = ''; for ($i = 0; $i < $n; $i++) { $o .= chr(mt_rand(0, 255)); } return $o; } }
$DATA = __DIR__ . '/data';
if (!is_dir($DATA)) { @mkdir($DATA, 0755, true); }
foreach (array('sessions', 'cool') as $d) { if (!is_dir("$DATA/$d")) { @mkdir("$DATA/$d", 0755, true); } }

function cors($allowed) {
    $o = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
    if ($o !== '' && in_array($o, $allowed, true)) {
        header("Access-Control-Allow-Origin: $o");
        header('Vary: Origin');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
    }
}
function out($arr) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($arr);
    exit;
}
function fail($msg, $extra = array()) { out(array_merge(array('error' => $msg), $extra)); }

// guarded files: the first line is the GUARD (a php open tag, exit, a close tag); NEVER write a php close tag inside a // comment, it ends php mode
function guard_read($path) {
    if (!is_file($path)) { return null; }
    $fh = fopen($path, 'r'); if (!$fh) { return null; }
    flock($fh, LOCK_SH);
    $txt = stream_get_contents($fh);
    flock($fh, LOCK_UN); fclose($fh);
    $nl = strpos($txt, "\n");
    return $nl === false ? '' : substr($txt, $nl + 1);
}
function guard_write($path, $body) {
    $fh = fopen($path, 'c'); if (!$fh) { fail('storage error'); }
    flock($fh, LOCK_EX);
    ftruncate($fh, 0); rewind($fh);
    fwrite($fh, GUARD . $body);
    fflush($fh); flock($fh, LOCK_UN); fclose($fh);
}
function guard_append($path, $line) {
    $new = !is_file($path);
    $fh = fopen($path, 'a'); if (!$fh) { fail('storage error'); }
    flock($fh, LOCK_EX);
    if ($new || filesize($path) === 0) { fwrite($fh, GUARD); }
    fwrite($fh, $line . "\n");
    fflush($fh); flock($fh, LOCK_UN); fclose($fh);
}
function read_lines($path) {
    $b = guard_read($path); if ($b === null || $b === '') { return array(); }
    $rows = array();
    foreach (explode("\n", $b) as $l) { if ($l === '') { continue; } $j = json_decode($l, true); if (is_array($j)) { $rows[] = $j; } }
    return $rows;
}
function truth() {
    global $DATA;
    $f = "$DATA/truth.php";
    if (!is_file($f)) { fail('truth file missing on the server'); }
    return include $f;
}
function client_ip() { return isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : ''; }
function hsh($x) { global $SALT; return substr(hash('sha256', $SALT . '|' . $x), 0, 24); }
function median_of($v) {
    $n = count($v); if (!$n) { return null; }
    sort($v); $m = intdiv($n, 2);
    return $n % 2 ? $v[$m] : 0.5 * ($v[$m - 1] + $v[$m]);
}
function summary_of($v) {
    $n = count($v); if (!$n) { return array('n' => 0, 'mean' => null, 'median' => null, 'min' => null, 'max' => null); }
    return array('n' => $n, 'mean' => array_sum($v) / $n, 'median' => median_of($v), 'min' => min($v), 'max' => max($v));
}
function side_stats($errs) {   // errs: list of array('R' => mm, 'L' => mm)
    $r = array(); $l = array(); $b = array();
    foreach ($errs as $e) { $r[] = $e['R']; $l[] = $e['L']; $b[] = $e['R']; $b[] = $e['L']; }
    return array('R' => summary_of($r), 'L' => summary_of($l), 'both' => summary_of($b));
}
function dist3($a, $b) { return sqrt(pow($a[0] - $b[0], 2) + pow($a[1] - $b[1], 2) + pow($a[2] - $b[2], 2)); }
function point_ok($p) {
    if (!is_array($p) || count($p) !== 3) { return false; }
    foreach ($p as $x) { if (!is_numeric($x) || abs($x) > 5000) { return false; } }
    return true;
}
function clean_nick($s) {
    $s = trim((string)$s);
    $s = strip_tags($s);
    $s = preg_replace('/[^\p{L}\p{N} _\.\-§]/u', '', $s);
    $s = preg_replace('/\s+/u', ' ', $s);
    $s = mb_substr($s, 0, 24, 'UTF-8');
    return $s === '' ? 'anonymous' : $s;
}
function cooldown_left($keys) {
    global $DATA, $COOLDOWN;
    $left = 0;
    foreach ($keys as $k) {
        $f = "$DATA/cool/$k.txt";
        if (is_file($f)) { $t = (int)trim((string)@file_get_contents($f)); $left = max($left, $t + $COOLDOWN - time()); }
    }
    return max(0, $left);
}
function set_cooldown($keys) { global $DATA; foreach ($keys as $k) { @file_put_contents("$DATA/cool/$k.txt", (string)time(), LOCK_EX); } }
function load_session($id) {
    global $DATA;
    if (!preg_match('/^[a-f0-9]{24}$/', (string)$id)) { fail('unknown session'); }
    $b = guard_read("$DATA/sessions/$id.php"); if ($b === null) { fail('unknown session'); }
    $s = json_decode($b, true); if (!is_array($s)) { fail('unknown session'); }
    return $s;
}
function save_session($id, $s) { global $DATA; guard_write("$DATA/sessions/$id.php", json_encode($s)); }

// ------------------------------------------------------------------ routing
cors($ALLOWED_ORIGINS);
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
$action = isset($_GET['action']) ? $_GET['action'] : '';
$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) { $body = array(); }

if ($action === 'init') {
    $T = truth(); $tut = array();
    foreach ($T['cases'] as $tok => $c) { if ($c['role'] === 'tutorial') { $tut[] = $tok; } }
    out(array('tutorial' => $tut, 'demo' => false));
}

if ($action === 'start') {
    $client = isset($body['client']) ? (string)$body['client'] : '';
    if (strlen($client) < 8 || strlen($client) > 80) { fail('bad client'); }
    $keys = array(hsh('c' . $client), hsh('i' . client_ip()));
    $left = cooldown_left($keys);
    if ($left > 0) { fail('cooldown', array('cooldown' => $left)); }
    // rate limit on new runs per IP and hour
    $rl = "$DATA/cool/rl_" . $keys[1] . '.txt'; $now = time(); $stamps = array();
    if (is_file($rl)) { foreach (explode(',', (string)@file_get_contents($rl)) as $t) { if ((int)$t > $now - 3600) { $stamps[] = (int)$t; } } }
    if (count($stamps) >= $MAX_STARTS_HOUR) { fail('too many runs from this address, try later', array('cooldown' => 600)); }
    $stamps[] = $now; @file_put_contents($rl, implode(',', $stamps), LOCK_EX);

    $T = truth(); $scored = array(); $alc = array();
    foreach ($T['cases'] as $tok => $c) { if ($c['role'] === 'scored') { $scored[] = $tok; } elseif ($c['role'] === 'alcapa') { $alc[] = $tok; } }
    if (count($scored) < $N_SCORED) { fail('not enough scored cases on the server'); }
    shuffle($scored); shuffle($alc);
    $scored = array_slice($scored, 0, $N_SCORED); $alc = array_slice($alc, 0, $N_ALCAPA);
    $seq = array(); $head = $N_SCORED - $N_ALCAPA;
    for ($i = 0; $i < $head; $i++) { $seq[] = array('token' => $scored[$i], 'kind' => 'scored'); }
    for ($i = 0; $i < $N_ALCAPA; $i++) {
        $seq[] = array('token' => $scored[$head + $i], 'kind' => 'scored');
        if (isset($alc[$i])) { $seq[] = array('token' => $alc[$i], 'kind' => 'alcapa'); }
    }
    $id = bin2hex(random_bytes(12));
    save_session($id, array('client' => $keys[0], 'ip' => $keys[1], 'nickname' => isset($body['nickname']) ? clean_nick($body['nickname']) : '',
                            'started' => $now, 'seq' => $seq, 'errors' => new stdClass(), 'done' => new stdClass(), 'finished' => false));
    out(array('session' => $id, 'cases' => $seq, 'cooldown' => 0));
}

if ($action === 'submit') {
    $id = isset($body['session']) ? $body['session'] : ''; $s = load_session($id);
    $tok = isset($body['token']) ? (string)$body['token'] : '';
    $inseq = false; foreach ($s['seq'] as $q) { if ($q['token'] === $tok) { $inseq = true; } }
    if (!$inseq) { fail('case not in this run'); }
    $P = isset($body['points']) ? $body['points'] : null;
    if (!is_array($P) || !isset($P['R']) || !isset($P['L']) || !point_ok($P['R']) || !point_ok($P['L'])) { fail('bad points'); }
    $R = array_map('floatval', $P['R']); $L = array_map('floatval', $P['L']);
    $T = truth(); $c = $T['cases'][$tok];
    $done = (array)$s['done'];
    $line = array('t' => time(), 'session' => $id, 'client' => $s['client'], 'nick' => $s['nickname'], 'token' => $tok, 'role' => $c['role'],
                  'R' => $R, 'L' => $L, 'ms' => isset($body['ms']) ? (int)$body['ms'] : null, 'scrolls' => isset($body['scrolls']) ? (int)$body['scrolls'] : null,
                  'repeat' => isset($done[$tok]));
    guard_append("$DATA/annotations.log.php", json_encode($line));
    if ($c['role'] === 'alcapa') {
        $done[$tok] = 1; $s['done'] = $done; save_session($id, $s);
        out(array('kind' => 'alcapa'));
    }
    $err = array('R' => dist3($R, $c['gt']['R']), 'L' => dist3($L, $c['gt']['L']));
    $errors = (array)$s['errors'];
    if (!isset($errors[$tok])) { $errors[$tok] = $err; $done[$tok] = 1; $s['errors'] = $errors; $s['done'] = $done; save_session($id, $s); }
    else { $err = $errors[$tok]; }                      // a case counts only the first time
    $models = array();
    foreach ($T['models'] as $m) {
        $mm = $c['models'][$m['name']];
        $models[] = array('name' => $m['name'], 'color' => $m['color'], 'R' => $mm['R'], 'L' => $mm['L'], 'err' => $mm['err']);
    }
    out(array('kind' => 'scored', 'reveal' => array('gt' => $c['gt'], 'models' => $models, 'user' => $err)));
}

if ($action === 'finish') {
    $id = isset($body['session']) ? $body['session'] : ''; $s = load_session($id);
    if ($s['finished']) {                                   // already saved (e.g. the answer was lost on the network and the browser asks again): same answer
        if (isset($s['result'])) { out($s['result']); }
        fail('this run was already saved');
    }
    $errors = array_values((array)$s['errors']);
    if (count($errors) < $N_SCORED) { fail('the run is not complete'); }
    $nick = clean_nick(isset($body['nickname']) ? $body['nickname'] : '');
    $trials = read_lines("$DATA/trials.log.php"); $n = 1;
    foreach ($trials as $t) { if (mb_strtolower($t['nickname'], 'UTF-8') === mb_strtolower($nick, 'UTF-8')) { $n++; } }
    $row = array('nickname' => $nick, 'trial' => $n, 'time' => time() * 1000, 'stats' => side_stats($errors));
    guard_append("$DATA/trials.log.php", json_encode($row));
    $res = array('trial' => $n, 'time' => $row['time'], 'nickname' => $nick, 'cooldown' => $COOLDOWN);
    $s['finished'] = true; $s['result'] = $res; save_session($id, $s);
    set_cooldown(array($s['client'], $s['ip']));
    out($res);
}

if ($action === 'leaderboard') {
    $T = truth(); $scored = array();
    foreach ($T['cases'] as $c) { if ($c['role'] === 'scored') { $scored[] = $c; } }
    $models = array();
    foreach ($T['models'] as $m) {
        $errs = array(); foreach ($scored as $c) { $errs[] = $c['models'][$m['name']]['err']; }
        $models[] = array('name' => $m['name'], 'color' => $m['color'], 'stats' => side_stats($errs));
    }
    $trials = read_lines("$DATA/trials.log.php");
    $keep = array(); $now_ms = time() * 1000;
    foreach ($trials as $t) {                              // developer tests only show for a few minutes after they were saved
        if ($t['nickname'] === $DEV_NICK && ($now_ms - $t['time']) > $DEV_VISIBLE * 1000) { continue; }
        $keep[] = $t;
    }
    $trials = $keep;
    if (count($trials) > $MAX_TRIALS) { $trials = array_slice($trials, -$MAX_TRIALS); }
    out(array('models' => $models, 'trials' => $trials));
}

if ($action === 'meta') {      // meta.json of a case, through the api so that it carries the CORS header (a plain static file on this host does not)
    $tok = isset($body['token']) ? (string)$body['token'] : (isset($_GET['token']) ? (string)$_GET['token'] : '');
    if (!preg_match('/^[a-f0-9]{12}$/', $tok)) { fail('bad token'); }
    $f = __DIR__ . '/slices/' . $tok . '/meta.json';
    if (!is_file($f)) { fail('unknown case'); }
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: public, max-age=3600');
    readfile($f);
    exit;
}

fail('unknown action');
