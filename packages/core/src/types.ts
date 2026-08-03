import type { components } from "./generated/schema";

type Schemas = components["schemas"];

export type SignCandidate = Schemas["SignCandidate"];
export type RecognitionResult = Schemas["RecognitionResult"];
export type RecognizeRequest = Schemas["RecognizeRequest"];
export type PresetPhrase = Schemas["PresetPhrase"];

export type HandFrame = number[][];
export type LandmarkWindow = HandFrame[];

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
