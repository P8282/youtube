// YT PiP 도우미 - background
// 확장 메뉴(툴바) 버튼을 누르면 현재 탭의 유튜브 임베드 iframe 안 content script에 PiP 전환을 요청한다.
// 대상 iframe이 없거나 실패하면 아이콘 배지에 '!'를 3초간 표시한다.
var api = (typeof browser !== 'undefined') ? browser : chrome;

function flashBadge(tabId, text) {
  try {
    api.action.setBadgeText({ tabId: tabId, text: text });
    setTimeout(function () { api.action.setBadgeText({ tabId: tabId, text: '' }); }, 3000);
  } catch (e) {}
}

function onAction(tab) {
  if (!tab || tab.id == null) return Promise.resolve(null);
  return Promise.resolve(api.tabs.sendMessage(tab.id, { ytpip: 1, type: 'toggle' })).then(function (res) {
    if (!res || !res.ok) flashBadge(tab.id, '!');
    return res || null;
  }, function () {
    // 이 탭에 대상 iframe이 없음(다른 사이트이거나 플레이어가 아직 없음)
    flashBadge(tab.id, '!');
    return null;
  });
}

api.action.onClicked.addListener(onAction);
