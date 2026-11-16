// ==UserScript==
// @name         YT PiP 도우미
// @namespace    https://p8282.github.io/youtube/
// @version      0.1.0
// @description  유튜브 PiP 플레이어 페이지의 유튜브 영상을 화면 속 화면(PiP)으로 엽니다. (Resources/content.js와 본문 동일)
// @match        https://www.youtube.com/embed/*
// @match        https://www.youtube-nocookie.com/embed/*
// @run-at       document-start
// @inject-into  content
// @grant        none
// @updateURL    https://raw.githubusercontent.com/P8282/youtube/main/safari-extension/ytpip-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/P8282/youtube/main/safari-extension/ytpip-helper.user.js
// ==/UserScript==

// YT PiP 도우미 - content script
// 유튜브 임베드 iframe(www.youtube.com/embed, www.youtube-nocookie.com/embed) 안에서만 실행된다.
// 부모 페이지가 허용 목록(ALLOWED_PARENT)에 있을 때만 동작하고, 그 외 사이트의 임베드에는 아무 일도 하지 않는다.
//
// PiP 실행 방식은 PiPifier(https://github.com/arnoappenzeller/PiPifier)와 같은 원리:
//   video.webkitSetPresentationMode('picture-in-picture')
// 표준 API(requestPictureInPicture)가 있는 브라우저에서는 그것을 대신 사용한다.
// 두 API 모두 사용자 동작(제스처) 안에서 호출되어야 하므로, 요청을 받으면 기다리지 않고 바로 호출한다.
(function () {
  'use strict';

  if (window.__ytpipHelperLoaded) return;
  window.__ytpipHelperLoaded = true;

  // 이 확장이 도와줄 부모 페이지 출처. 다른 주소에 배포했다면 여기에 추가한다.
  var ALLOWED_PARENT = [
    /^https:\/\/p8282\.github\.io$/,
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/
  ];
  var TAG = 'ytpip-ext';
  var CONFIRM_MS = 1500;

  // 최상위 페이지 바로 아래의 iframe에서만 동작
  if (window === window.top || window.parent !== window.top) return;

  function allowed(origin) {
    for (var i = 0; i < ALLOWED_PARENT.length; i++) if (ALLOWED_PARENT[i].test(origin)) return true;
    return false;
  }

  // 부모 출처: location.ancestorOrigins(Safari·Chromium 지원)로 확인하고, 없으면 부모의 ping으로 알게 된다.
  var parentOrigin = null;
  try {
    var ao = window.location.ancestorOrigins;
    if (ao && ao.length && allowed(ao[0])) parentOrigin = ao[0];
    else if (ao && ao.length) return; // 허용되지 않은 사이트의 임베드: 아무것도 하지 않음
  } catch (e) {}

  // 확장과 유저스크립트를 함께 설치해도 페이지 버튼 요청은 한 번만 처리(실행 환경은 달라도 DOM은 공유).
  // 먼저 실행된 쪽이 primary가 되어 페이지와의 메시지를 맡고, 확장 메뉴 요청은 각자 받는다.
  var root = document.documentElement;
  var primary = !(root && root.hasAttribute('data-ytpip-helper'));
  if (primary && root) root.setAttribute('data-ytpip-helper', '1');

  var busy = false;

  function post(msg) {
    if (!parentOrigin) return;
    msg[TAG] = 1;
    try { window.parent.postMessage(msg, parentOrigin); } catch (e) {}
  }

  function getVideo() {
    return document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  function isPip(v) {
    if (!v) return false;
    if (document.pictureInPictureElement === v) return true;
    return v.webkitPresentationMode === 'picture-in-picture';
  }

  function canWebkitPip(v) {
    return typeof v.webkitSetPresentationMode === 'function' &&
      typeof v.webkitSupportsPresentationMode === 'function' &&
      v.webkitSupportsPresentationMode('picture-in-picture');
  }

  function canStandardPip(v) {
    return typeof v.requestPictureInPicture === 'function' && document.pictureInPictureEnabled !== false;
  }

  // 결과 보고: reply(결과) → 부모 페이지와(있으면) 확장 툴바 호출자 모두에게
  function finish(reply, result) {
    busy = false;
    result.type = 'result';
    post(result);
    if (reply) reply(result);
  }

  function waitForPip(v, want, cb) {
    var start = Date.now();
    (function check() {
      if (isPip(v) === want) return cb(true);
      if (Date.now() - start > CONFIRM_MS) return cb(false);
      setTimeout(check, 100);
    })();
  }

  // 반드시 사용자 동작으로 시작된 이벤트 처리 안에서 동기적으로 호출할 것
  function toggle(reply) {
    if (busy) return finish(reply, { ok: false, reason: 'busy' });
    var v = getVideo();
    if (!v) return finish(reply, { ok: false, reason: 'no-video' });
    busy = true;

    if (isPip(v)) {
      try {
        if (document.pictureInPictureElement === v && document.exitPictureInPicture) document.exitPictureInPicture().catch(function () {});
        else v.webkitSetPresentationMode('inline');
      } catch (e) {}
      waitForPip(v, false, function (done) {
        finish(reply, done ? { ok: true, action: 'exit' } : { ok: false, reason: 'exit-failed' });
      });
      return;
    }

    if (v.readyState === 0) return finish(reply, { ok: false, reason: 'not-ready' });

    // 유튜브가 PiP를 막아 둔 경우 사용자 요청이므로 해제한다(PiPifier와 같은 목적)
    if (v.disablePictureInPicture) v.disablePictureInPicture = false;
    if (v.hasAttribute('disablepictureinpicture')) v.removeAttribute('disablepictureinpicture');

    if (canWebkitPip(v)) {
      // WebKit은 권한이 없으면 예외 없이 무시하므로 실제 진입 여부를 확인한다
      try { v.webkitSetPresentationMode('picture-in-picture'); } catch (e) {}
      waitForPip(v, true, function (done) {
        finish(reply, done ? { ok: true, action: 'enter' } : { ok: false, reason: 'not-allowed' });
      });
      return;
    }

    if (canStandardPip(v)) {
      v.requestPictureInPicture().then(function () {
        finish(reply, { ok: true, action: 'enter' });
      }, function (err) {
        var name = err && err.name;
        finish(reply, {
          ok: false,
          reason: name === 'NotAllowedError' ? 'not-allowed' :
                  name === 'NotSupportedError' ? 'not-supported' :
                  name === 'InvalidStateError' ? 'not-ready' : 'failed',
          detail: String(err && err.message || err)
        });
      });
      return;
    }

    finish(reply, { ok: false, reason: 'not-supported' });
  }

  function sendState() {
    post({ type: 'state', active: isPip(getVideo()) });
  }

  // PiP 진입·종료(사용자가 PiP 창을 닫는 경우 포함)를 부모에게 알림
  if (primary) ['enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged'].forEach(function (name) {
    document.addEventListener(name, sendState, true);
  });

  // 부모 페이지 → 확장: { ytpip: 1, type: 'ping' | 'toggle' }
  if (primary) window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent || !allowed(ev.origin)) return;
    var d = ev.data;
    if (!d || typeof d !== 'object' || d.ytpip !== 1) return;
    if (!parentOrigin) parentOrigin = ev.origin;
    if (ev.origin !== parentOrigin) return;
    if (d.type === 'ping') {
      post({ type: 'hello', version: 1 });
      sendState();
    } else if (d.type === 'toggle') {
      toggle(null);
    }
  });

  // 확장 툴바(메뉴) → background → 여기
  var rt = (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime :
           (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime : null;
  if (rt && rt.onMessage) {
    rt.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || msg.ytpip !== 1 || msg.type !== 'toggle') return;
      if (!parentOrigin) { sendResponse({ ok: false, reason: 'not-our-page' }); return; }
      toggle(sendResponse);
      return true; // 비동기 응답
    });
  }

  if (primary) post({ type: 'hello', version: 1 });
})();
