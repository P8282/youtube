# YT PiP 도우미 (Safari 웹 확장 프로토타입)

`index.html`(유튜브 PiP 플레이어)의 **PiP** 버튼이 실제 화면 속 화면(PiP)을 열 수 있게 해 주는 최소 Safari 웹 확장입니다.

> 상태: 프로토타입. 아이폰 + Userscripts(설치 A)에서 연결 감지와 PiP 진입을 확인했습니다. Xcode 빌드(설치 B)는 미검증입니다. 아래 "검증 범위"를 확인하세요.

## 왜 확장이 필요한가

- 유튜브 영상의 `<video>`는 `https://www.youtube.com/embed/...` iframe 안에 있습니다. 동일 출처 정책 때문에 페이지(`p8282.github.io`)의 JavaScript는 이 video에 접근할 수 없습니다.
- 유튜브 IFrame Player API에는 PiP 명령이 없습니다.
- iframe의 `allow="picture-in-picture"`는 iframe 안의 문서가 PiP를 *쓸 수 있도록 허용*할 뿐, 바깥에서 PiP를 *실행*하지는 않습니다.
- 따라서 iframe 안에서 코드를 실행하는 수단이 필요합니다. 일반 웹페이지가 쓸 수 있는 수단은 없고, 브라우저 확장의 content script는 가능합니다.

## 동작 방식

```
[index.html PiP 버튼 클릭]
   └─ 클릭 처리 안에서 바로 iframe.contentWindow.postMessage({ytpip:1, type:'toggle'}, 'https://www.youtube.com')
        └─ (WebKit은 postMessage로 사용자 제스처를 최대 1초 전달)
[content.js: youtube.com/embed iframe 안]
   └─ video.webkitSetPresentationMode('picture-in-picture')   ← PiPifier와 같은 API
      (webkit API가 없으면 video.requestPictureInPicture())
   └─ 진입/종료/실패를 부모 페이지에 postMessage로 보고 → 버튼 상태·안내 문구 갱신
```

또 하나의 실행 경로: Safari의 확장 메뉴에서 "YT PiP 도우미"를 누르면 `background.js`가 현재 탭의 content script에 같은 전환 요청을 보냅니다. PiPifier가 쓰는 방식입니다.

### 안전장치

- content script는 `www.youtube.com/embed/*`, `www.youtube-nocookie.com/embed/*` 프레임에만 주입됩니다(manifest `content_scripts`). 전체 사이트 권한은 요청하지 않습니다.
- 부모 페이지 출처가 `content.js`의 `ALLOWED_PARENT` 허용 목록(`https://p8282.github.io`, `localhost`, `127.0.0.1`)에 있을 때만 동작합니다. 다른 사이트의 유튜브 임베드에서는 아무것도 하지 않습니다.
- 다른 주소에 배포했다면 `ALLOWED_PARENT`에 그 출처를 추가하세요.
- 같은 요청이 겹치면 두 번째 요청은 `busy`로 거절합니다(페이지 쪽에서도 응답 대기 중에는 다시 보내지 않음).
- 처리하는 상황과 결과 코드:

  | 상황 | 결과 코드 |
  |---|---|
  | 영상 없음 | `no-video` |
  | 재생 전 | `not-ready` |
  | 권한 거부 | `not-allowed` |
  | 미지원 | `not-supported` |

- WebKit의 `webkitSetPresentationMode`는 권한이 없으면 예외 없이 무시합니다. 그래서 1.5초 동안 실제로 PiP에 들어갔는지 확인한 뒤에만 성공으로 보고합니다.
- 유튜브가 video에 `disablepictureinpicture`를 걸어 둔 경우, 사용자가 요청했을 때만 해제합니다.

### 곡이 바뀔 때 PiP 다시 켜기

- 유튜브 플레이어는 곡을 바꿀 때 같은 `<video>`의 소스를 비웠다가 다시 채웁니다.
- WebKit은 소스가 없는 video의 PiP를 강제로 끕니다(`HTMLMediaElement.cpp`, 리소스 선택 중 `src` 없음 → `exitFullscreen()`). 그래서 다음 곡으로 넘어가면 PiP가 꺼집니다.
- content script의 처리:
  - 사용자가 켠 PiP가 곡 전환 구간 안에서 꺼지면, 새 영상의 `loadstart` → `loadedmetadata` → `loadeddata` → `canplay` → `playing` 시점마다 PiP를 다시 요청합니다(최대 8초).
  - 곡 전환 구간은 `emptied`부터 새 영상의 `playing`까지입니다(최대 10초).
  - 사용자가 PiP 창을 직접 닫았거나 PiP 끄기를 눌렀다면 다시 켜지 않습니다.
- 이 재요청은 사용자 동작 없이 이루어지므로 Safari가 허용할 때만 성공합니다.
  - WebKit에는 사용자 동작으로 재생된 영상이 끝난 뒤 1초 동안의 유예(`MediaFinishedGrace`)가 있습니다. 그 밖의 경우는 Safari 설정에 따라 달라집니다.
- 결과 코드:

  | 결과 | 의미 | 페이지 안내 |
  |---|---|---|
  | `reenter` | 다시 켜기 성공 | "다음 영상도 PiP로 이어서 재생합니다" |
  | `reenter-failed` | 8초 안에 실패 | "PiP를 다시 누르세요" |

## 파일

| 파일 | 역할 |
|---|---|
| `Resources/manifest.json` | Manifest V3. `content_scripts`(유튜브 임베드 2개 도메인, `all_frames`), `action`, `background.service_worker` |
| `Resources/content.js` | iframe 안에서 video를 찾고 PiP 진입·종료, 부모 페이지와 메시지 교환 |
| `Resources/background.js` | 확장 메뉴 버튼 → content script에 전환 요청, 실패 시 배지 `!` |
| `Resources/images/` | 아이콘 |
| `ytpip-helper.user.js` | 유저스크립트판(설치 A). 머리말 + `Resources/content.js`와 같은 본문 |

## 설치 A: 유저스크립트 (Mac·Xcode 불필요)

App Store의 무료 앱 [Userscripts](https://itunes.apple.com/us/app/userscripts/id1463298887)(오픈소스 [quoid/userscripts](https://github.com/quoid/userscripts), 링크는 저장소 README 기준)로 같은 코드를 실행합니다.

1. 아이폰에 "Userscripts" 앱을 설치하고 한 번 엽니다. 처음 열 때 스크립트를 저장할 폴더를 고르라고 하면 아무 폴더나 지정합니다.
2. 설정 → (앱 →) Safari → 확장 프로그램 → Userscripts를 켭니다.
   - 웹사이트 권한은 최소한 `youtube.com`과 `youtube-nocookie.com`을 허용해야 합니다.
   - Userscripts 자체는 모든 사이트 권한을 요청합니다. 확장 앱(설치 B)보다 권한 범위가 넓다는 점이 차이입니다.
3. Safari에서 아래 주소를 열고, 주소창의 확장 메뉴에서 Userscripts를 눌러 설치합니다.
   `https://raw.githubusercontent.com/P8282/youtube/main/safari-extension/ytpip-helper.user.js`
4. 플레이어 페이지를 새로 고치고, "PiP 버튼 사용 조건"의 상태가 **연결됨**인지 확인합니다.

이 방식에서는 확장 메뉴로 실행하는 두 번째 경로가 없습니다. 페이지의 PiP 버튼만 사용합니다.

`ytpip-helper.user.js`의 본문은 `Resources/content.js`와 같습니다. 코드를 고칠 때는 `content.js`를 고친 뒤 유저스크립트 머리말 아래를 다시 붙여 넣으세요.

근거(Userscripts `8b743e37dd7dfc8a510aff4e5e2ab8b1cc9210df`):
- `public/ext/safari-16.4/manifest.json`: `all_frames: true`
- `xcode/Ext-Safari/Functions.swift`: iframe 주소에도 `@match`를 검사하고, `@noframes`가 없으면 iframe에도 주입합니다.
- `src/ext/content-scripts/entry-userscripts.js`: `@inject-into content`이면 확장 실행 환경에서 실행합니다(유튜브 CSP 영향 없음).
- `src/ext/background/main.js`: `.user.js` 주소를 설치 대상으로 인식합니다.

iOS 앱에서 실제로 iframe에 주입되는지는 **미검증**입니다.

확장 앱과 유저스크립트를 함께 설치해도 페이지 버튼 요청은 한 번만 처리됩니다. iframe의 `data-ytpip-helper` 속성으로 먼저 실행된 쪽만 페이지와 통신합니다.

## 설치 B: 확장 앱 빌드 (Mac + Xcode 필요)

이 저장소의 작업 환경(Linux)에서는 빌드할 수 없었습니다. 아래 절차는 Apple 공식 변환 도구 기준이며 실행해 보지 않았습니다.

1. Mac에 Xcode를 설치합니다.
2. 저장소 루트에서 실행합니다. 옵션 이름은 Xcode 버전에 따라 다를 수 있으니 먼저 `xcrun safari-web-extension-converter --help`로 확인하세요.
   ```sh
   xcrun safari-web-extension-converter safari-extension/Resources \
     --project-location safari-extension/xcode \
     --app-name "YT PiP 도우미" \
     --bundle-identifier com.example.ytpiphelper \
     --ios-only --swift --copy-resources
   ```
   `--bundle-identifier`는 본인 것으로 바꾸세요. 생성된 `safari-extension/xcode/`는 커밋하지 않아도 됩니다.
3. Xcode에서 앱 타깃과 확장 타깃 **둘 다** Signing & Capabilities → Team을 지정합니다. 무료 Apple ID로도 설치할 수 있지만 7일 뒤 다시 설치해야 합니다.
4. 아이폰을 연결하고 실행 대상으로 고른 뒤 Run(⌘R)을 누릅니다.
   - 처음이라면 아이폰의 설정 → 개인정보 보호 및 보안 → 개발자 모드를 켜야 합니다.
   - 설정 → 일반 → VPN 및 기기 관리에서 개발자를 신뢰해야 할 수도 있습니다.
5. 아이폰에서 설정 → (앱 →) Safari → 확장 프로그램 → "YT PiP 도우미"를 켭니다.
6. 같은 화면에서 웹사이트 접근 권한을 `youtube.com`, `youtube-nocookie.com`에 대해 **허용**으로 둡니다. Safari에서 처음 쓸 때 묻는 경우도 있습니다.

## 아이폰 사용 순서

1. Safari에서 플레이어 페이지(`https://p8282.github.io/youtube/`)를 엽니다.
2. 페이지 아래 "PiP 버튼 사용 조건"의 상태가 **연결됨**인지 확인합니다.
3. 영상을 재생합니다.
4. **PiP** 버튼을 누릅니다.
5. 거부 안내가 나오면 영상 화면을 한 번 탭한 뒤 바로 PiP를 누르거나, 주소창의 페이지 메뉴에 있는 확장 목록에서 "YT PiP 도우미"를 누릅니다.
6. PiP 창이 뜨면 홈 화면으로 나가도 다른 앱 위에서 계속 재생됩니다.

## 아이폰 확인 절차

| # | 확인 | 기대 결과 |
|---|---|---|
| 1 | 설치 후 페이지 열기 | "확장 연결 상태: 연결됨" ✅ 확인(Userscripts) |
| 2 | 영상 재생 → PiP | PiP 창이 뜨고 버튼이 "PiP 끄기"로 바뀜 ✅ 확인(Userscripts, 사전 탭 없이) |
| 3 | 홈 화면으로 이동 | 다른 앱 위에서 PiP 계속 재생 |
| 4 | PiP 끄기 / PiP 창 닫기 | 페이지 플레이어로 복귀, 버튼 "PiP" |
| 5 | 재생 전(목록에서 곡만 선택) PiP | "재생을 시작한 뒤 다시 누르세요" |
| 6 | PiP 중 다음 곡 / 곡 끝나고 자동 다음 | 0.1.0: PiP 꺼짐 ❌ 확인됨. 0.2.0: "이어서 재생" 또는 "PiP를 다시 누르세요" 중 어느 쪽인지 기록 |
| 7 | 2가 거부될 때 확장 메뉴 실행 | PiP 진입 여부 기록 |

6의 결과를 알려 주시면 그에 맞게 조정하겠습니다.

## 검증 범위

- **완료**(Linux, Chromium 확장 로드)
  - 유튜브 iframe API와 임베드를 가짜로 바꾼 하네스에서 진행했습니다. 다른 출처 iframe에 실제 `<video>`가 들어 있습니다.
  - 확인 항목: content script 주입 범위, 허용 목록, 연결 감지, 실제 PiP 진입·종료, 외부 종료 동기화, 중복 요청, 재생 전, 확장 메뉴 경로.
  - 곡 전환 시 PiP 다시 켜기: 하네스가 WebKit의 "소스 비움 → PiP 종료"를 흉내 냅니다. 수동 다음, 자동 다음, 사용자가 닫은 경우, 실패 안내를 확인했습니다.
- **완료**(아이폰 + Userscripts, 사용자 확인)
  - 유저스크립트가 유튜브 iframe에 주입되고 연결이 감지됩니다.
  - 페이지 PiP 버튼 한 번으로 실제 PiP에 진입합니다.
  - 0.1.0에서는 다음 곡으로 넘어가면 PiP가 꺼졌습니다. 그래서 위의 다시 켜기 기능을 추가했습니다.
- **미검증**
  - 아이폰에서 곡 전환 시 PiP 다시 켜기(0.2.0), PiP 종료 후 복귀, 홈 화면에서의 계속 재생.
  - 확장 앱(설치 B) 전체.
  - Xcode 변환·빌드·서명.
  - 실제 유튜브 임베드의 DOM: `video.html5-main-video`를 찾는다는 가정은 PiPifier와 같은 방식(`video` 태그 탐색)에 기댄 것입니다.
  - Chromium은 iOS Safari와 사용자 제스처 정책이 다르므로, Chromium 결과로 아이폰 동작을 보장할 수 없습니다.

## 근거

- PiPifier `110ac3b65d9664b4314bc671fcefd008747032a6`
  - `PiPifier iOS/PiPifier-WebExtension/Resources/{manifest.json,content.js,background.js}`
  - `PiPifier iOS/PiPifier/PiPifierExtensionJavaScript.js`
  - `PiPifier iOS/PiPifier/ActionRequestHandler.swift`
  - `macOS/PiPifier-Safari-Extension/{script.js,Info.plist}`
- WebKit `main`(조회 시점 `afa045162a402cbce52886321ee128b9c59de68d`)
  - `Source/WebCore/html/HTMLVideoElement.cpp`: `webkitSetPresentationMode` → `fullscreenPermitted()`
  - `Source/WebCore/html/MediaElementSession.cpp`: `fullscreenPermitted`
  - `Source/WebCore/dom/Document.cpp`: `mediaUserGestureReason`
  - `Source/WebCore/page/LocalDOMWindow.cpp`: postMessage 사용자 제스처 전달
  - `Source/WebCore/dom/UserGestureIndicator.h`: `maximumIntervalForUserGestureForwarding` = 1초
  - `Source/WebKit/UIProcess/Extensions/WebExtension.cpp`: `all_frames`, `service_worker`
