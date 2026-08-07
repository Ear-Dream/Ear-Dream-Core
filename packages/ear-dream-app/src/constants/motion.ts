/**
 * 애니메이션 공통 상수.
 *
 * 장식 애니메이션은 RN 코어 `Animated` 로만 만든다. Reanimated 는 설치되어 있지 않고,
 * 파형·로고 정도의 루프에 의존성을 추가할 이유가 없다.
 */
import { Platform } from 'react-native';

/**
 * 네이티브 드라이버 사용 여부.
 *
 * react-native-web 에는 네이티브 애니메이션 모듈이 없어서 `useNativeDriver: true` 를 주면
 * 콘솔 경고만 남기고 결국 JS 드라이버로 돈다. 웹에서는 명시적으로 끈다.
 * transform(scale/translate) 과 opacity 만 애니메이션하므로 네이티브에서는 켤 수 있다.
 */
export const USE_NATIVE_DRIVER = Platform.OS !== 'web';
