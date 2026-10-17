import type { Row } from "../../../src/lib/contracts";
export interface HistoryReader {
  rows(before: number | undefined, limit: number): Row[];
}
