import { pipeline, FeatureExtractionPipeline } from "@huggingface/transformers";

let _pipeline: FeatureExtractionPipeline | null = null;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!_pipeline) {
    _pipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return _pipeline;
}

export async function embedText(text: string): Promise<number[]> {
  if (!text.trim()) throw new Error("Cannot embed empty string.");
  const pipe = await getPipeline();
  const output = await pipe(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map(embedText));
}
