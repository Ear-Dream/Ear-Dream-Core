import { Image, StyleSheet } from 'react-native';

export interface WordIconProps {
  /** 어휘 단어 ID (`w_0165`). 파일명이 곧 이 값이다. */
  wordId: string;
  /** 한 변 길이(pt). 그림이 정사각이라 가로·세로가 같다. */
  size: number;
  /** 스크린 리더용 — 보통은 곁의 단어 글자가 이미 읽히므로 비워 둔다. */
  label?: string;
}

/**
 * 단어 픽토그램 (AAC 300종).
 *
 * 그림은 앱에 함께 실려 있다(`public/word-icons/{wordId}.png`) — 수어 시퀀스
 * (`public/sign-sequences/`)와 같은 방식이고 같은 이유다: 클론만으로 앱이 돌아야 하고,
 * 데모 현장 네트워크에 의존하지 않는다.
 *
 * ## 라벨이 아니라 ID 로 찾는다
 *
 * 어휘 항목의 `id` 는 안정적이지만 `label` 은 표시 문자열이라 바뀔 수 있다. 실제로 이
 * 프로젝트에서 라벨로 잇다가 한 번 어긋난 적이 있다 — 시안 예시 단어(자동차·버스·지하철)가
 * 서빙 어휘에 없어 그림이 조용히 안 떴다. 파일명을 ID 로 두면 그 사고가 원천적으로 없다.
 *
 * ## 색을 바꿀 수 없다
 *
 * 래스터라 `tintColor` 를 걸면 실루엣이 되어 그림이 사라진다. 후보 카드의 "선택됨" 표시가
 * 아이콘 색이 아니라 **테두리·배경**으로만 표현되는 이유다.
 *
 * 파일이 없으면 RN 의 Image 가 조용히 빈 자리를 남긴다 — 어휘 300단어는 모두 그림이 있고
 * (`목록.csv` 대조 완료), 없더라도 곁의 단어 글자가 뜻을 전하므로 대체 도형을 두지 않는다.
 */
export function WordIcon({ wordId, size, label }: WordIconProps) {
  return (
    <Image
      source={{ uri: `${ASSET_BASE}/${wordId}.png` }}
      style={[styles.image, { width: size, height: size }]}
      resizeMode="contain"
      accessibilityLabel={label}
      accessibilityElementsHidden={label === undefined}
      importantForAccessibility={label === undefined ? 'no-hide-descendants' : 'yes'}
    />
  );
}

/** `public/` 은 정적 서빙된다 — `expo export` 가 dist 로 그대로 복사한다. */
const ASSET_BASE = '/word-icons';

const styles = StyleSheet.create({
  image: {
    // 원본이 500x500 정도라 축소만 일어난다. 비율이 어긋난 몇 장(298/299)도 contain 이 흡수한다.
    resizeMode: 'contain',
  },
});
