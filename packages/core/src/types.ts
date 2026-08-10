import type { components } from "./generated/schema";

type Schemas = components["schemas"];

// ---- /recognize
export type RecognizeRequest = Schemas["RecognizeRequest"];
export type RecognitionResult = Schemas["RecognitionResult"];
export type SignSegment = Schemas["SignSegment"];
export type CaptureMeta = Schemas["CaptureMeta"];
export type BoundaryMode = Schemas["BoundaryMode"];
export type LandmarkFrame = Schemas["LandmarkFrame"];
export type HandObservation = Schemas["HandObservation"];
export type FaceObservation = Schemas["FaceObservation"];
export type PoseObservation = Schemas["PoseObservation"];
export type SignCandidate = Schemas["SignCandidate"];
export type RecognitionStatus = Schemas["RecognitionStatus"];
export type QualityIssue = Schemas["QualityIssue"];
export type PreprocessInfo = Schemas["PreprocessInfo"];

// ---- /compose-sentence
export type ComposeSentenceRequest = Schemas["ComposeSentenceRequest"];
export type SentenceResult = Schemas["SentenceResult"];
export type SentenceCandidate = Schemas["SentenceCandidate"];
export type SentenceSource = Schemas["SentenceSource"];

// ---- /vocabulary, /model, /health
export type VocabularyCatalog = Schemas["VocabularyCatalog"];
export type VocabularyEntry = Schemas["VocabularyEntry"];
export type GlossRef = Schemas["GlossRef"];
export type ModelInfo = Schemas["ModelInfo"];
export type LandmarkContract = Schemas["LandmarkContract"];
export type HealthResponse = Schemas["HealthResponse"];

// ---- /phrases
export type PresetPhrase = Schemas["PresetPhrase"];

/**
 * 손 랜드마크 1프레임 = 21점 x [x, y, z] (0~1 정규화) — 가독성 별칭.
 * 새 계약에서는 `HandObservation.landmarks` 가 이 형태다.
 * (생성 타입은 `number[][]` 라 구조적으로 다른 좌표 배열과 동형이므로,
 * 전송 시에는 반드시 이름 있는 모델(HandObservation 등)에 담는다.)
 */
export type HandFrame = number[][];

// 트랜스크립트는 MVP 단계에서 클라이언트 로컬 상태다. 서버가 메시지를 저장/동기화하게 되면
// Pydantic 스키마로 옮기고 generated 타입을 쓴다.
export type MessageDirection = "deaf_to_hearing" | "hearing_to_deaf";
export type MessageSource = "sign" | "preset" | "manual" | "stt";

export interface Message {
  id: string;
  direction: MessageDirection;
  text: string;
  source: MessageSource;
  createdAt: number;
}
