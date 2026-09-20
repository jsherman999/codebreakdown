import { body, credentials, failure, json } from '../../../lib/server';
import { listModels } from '../../../lib/providers';
export async function POST(request: Request) {
  try {
    const { key, provider } = credentials(await body(request));
    return json({ models: await listModels(provider, key, request.signal) });
  } catch (error) {
    return failure(error);
  }
}
