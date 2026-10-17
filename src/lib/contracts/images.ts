import { z } from "zod";

export const ImageId = z.uuid();
export type ImageInfo = { id: string; width: number; height: number };
