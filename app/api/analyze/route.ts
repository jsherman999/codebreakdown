import {
  AppError,
  body,
  credentials,
  failure,
  json,
  string,
} from '../../../lib/server';
import { generate } from '../../../lib/providers';
import {
  explanationContract,
  parseAnalysis,
  splitSource,
} from '../../../lib/analysis';
import { MAX_FILE_BYTES, MAX_FILES, type Step } from '../../../lib/types';
export async function POST(request: Request) {
  try {
    const data = await body(request);
    const { key, provider } = credentials(data);
    const model = string(data.model, 'model', 200);
    const modelPattern =
      provider === 'openrouter' ? /^[\w.:-]+(?:\/[\w.:-]+)*$/ : /^[\w.:-]+$/;
    if (!modelPattern.test(model))
      throw new AppError('Invalid model identifier.');
    const question =
      data.question === undefined
        ? ''
        : typeof data.question === 'string' && data.question.length <= 4000
          ? data.question.trim()
          : null;
    if (question === null)
      throw new AppError('Question must be at most 4,000 characters.');
    const paths = Array.isArray(data.paths) ? data.paths : [];
    if (
      paths.length > MAX_FILES ||
      paths.some((p) => typeof p !== 'string' || p.length > 1000)
    )
      throw new AppError('Invalid file list.');
    const context = JSON.stringify({ question, repositoryPaths: paths });
    if (data.mode === 'repository') {
      const files = data.files;
      if (
        !Array.isArray(files) ||
        !files.length ||
        files.length > 40 ||
        files.some(
          (f) => !f || typeof f.path !== 'string' || f.path.length > 1000,
        )
      )
        throw new AppError('Invalid overview batch.');
      const requested = files.map((f) => f.path);
      const prompt = `${explanationContract}\nThis is a FILE OVERVIEW, not a code walkthrough. Produce EXACTLY one step for EACH requested path. Explain its likely role and relationships based ONLY on path/extension. Explicitly label guesses as likely/inferred. Do not claim to have read contents. Binary assets, config, documentation, and lockfiles also need an entry. If a question exists, note likely relevance without omitting any file. Set startLine and endLine to 0.\nContext: ${context}\nRequested files: ${JSON.stringify(requested)}`;
      return json(
        parseAnalysis(
          await generate(provider, key, model, prompt, request.signal),
          { paths: requested },
        ),
      );
    }
    if (data.mode !== 'file') throw new AppError('Invalid analysis mode.');
    const file = data.file as { path?: unknown; content?: unknown };
    if (!file) throw new AppError('Choose a file.');
    const path = string(file.path, 'file path', 1000);
    if (
      typeof file.content !== 'string' ||
      new TextEncoder().encode(file.content).length > MAX_FILE_BYTES ||
      file.content.includes('\0')
    )
      throw new AppError('Choose a text file up to 120 KB.');
    if (!file.content.trim())
      return json({
        summary: 'This file is empty.',
        steps: [
          {
            title: 'Empty file',
            explanation:
              'There is no executable code or text to explain in this file.',
            startLine: 1,
            endLine: file.content.split('\n').length,
          },
        ],
      });
    const chunks = splitSource(file.content);
    const steps: Step[] = [];
    const summaries: string[] = [];
    for (const chunk of chunks) {
      if (request.signal.aborted)
        throw new DOMException('Aborted', 'AbortError');
      const prompt = `${explanationContract}\nAnalyze the exact numbered source section ${chunk.start}–${chunk.end} of ${path}. ${question ? 'Answer the question using relevant blocks in this section; if unrelated, explain briefly why.' : 'Explain ALL lines in this section in consecutive logical blocks, including imports, declarations, comments, and blank lines attached to neighboring blocks. No gaps from first through last line.'} Use absolute line numbers as given, never outside this section. Explain how functions connect using available source; distinguish missing context.\nContext: ${context}\nEarlier section summaries: ${JSON.stringify(summaries)}\nSource data:\n${chunk.text}`;
      const result = parseAnalysis(
        await generate(provider, key, model, prompt, request.signal),
        { start: chunk.start, end: chunk.end, full: !question },
      );
      summaries.push(result.summary);
      steps.push(...result.steps);
    }
    return json({ summary: summaries.join('\n\n'), steps });
  } catch (error) {
    return failure(error);
  }
}
