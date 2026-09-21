'use client';
import type { Usage } from '../lib/types';
import { usageTotals } from '../lib/usage';
const number = (value: number | null) =>
  value === null ? 'Unavailable' : value.toLocaleString();
const money = (value: number | null) =>
  value === null
    ? 'Unavailable'
    : value > 0 && value < 0.000001
      ? '<$0.000001'
      : `$${value.toFixed(6)}`;
export function UsagePanel({ records }: { records: Usage[] }) {
  const total = usageTotals(records);
  const available =
    records.length && records.every((r) => r.availableTokens !== null)
      ? Math.min(...records.map((r) => r.availableTokens!))
      : null;
  return (
    <details className="usage-panel">
      <summary>
        <span>Tokens {number(total.totalTokens)}</span>
        <span title="Lowest remaining capacity in an individual request; expand for input/context limits">
          Available {number(available)}
        </span>
        <span>
          {total.estimated ? 'Est. cost' : 'Cost'} {money(total.costUsd)}
        </span>
      </summary>
      <div className="usage-totals">
        <span>
          Input <b>{number(total.inputTokens)}</b>
        </span>
        <span>
          Output <b>{number(total.outputTokens)}</b>
        </span>
        <span>
          Requests <b>{records.length}</b>
        </span>
      </div>
      {records.map((r, i) => (
        <div className="usage-request" key={i}>
          <div>
            <strong>
              {i + 1}. {r.model}
            </strong>
            <span>{r.finishReason}</span>
          </div>
          <dl>
            <div>
              <dt>
                {r.capacityKind === 'context'
                  ? 'Context capacity'
                  : 'Input capacity'}
              </dt>
              <dd>{number(r.capacity)}</dd>
            </div>
            <div>
              <dt>Used / available</dt>
              <dd>
                {number(r.capacityUsed)} / {number(r.availableTokens)}
              </dd>
            </div>
            <div>
              <dt>Output / cap</dt>
              <dd>
                {number(r.outputTokens)} / {number(r.outputCap)}
              </dd>
            </div>
            <div>
              <dt>Reasoning / cached</dt>
              <dd>
                {number(r.reasoningTokens)} / {number(r.cachedTokens)}
              </dd>
            </div>
            <div>
              <dt>
                {r.costSource === 'estimated'
                  ? 'Est. cost'
                  : r.costSource === 'reported'
                    ? 'Reported cost'
                    : 'Cost'}
              </dt>
              <dd>{money(r.costUsd)}</dd>
            </div>
          </dl>
        </div>
      ))}
    </details>
  );
}
