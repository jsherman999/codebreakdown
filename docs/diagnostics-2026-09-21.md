# Local failure investigation — September 21, 2026

Inspected `~/Library/Logs/Codebreakdown/stdout.log` and `stderr.log` before changing the service. The error log was empty. The request log contained the following recent analysis failures:

| Response                 |   Elapsed | What can be established                                            |
| ------------------------ | --------: | ------------------------------------------------------------------ |
| 504 Gateway Timeout      | 90,020 ms | Matches the app's previous hard 90,000 ms upstream timeout.        |
| 422 Unprocessable Entity | 35,036 ms | Rejected generation or walkthrough; exact reason was not recorded. |
| 422 Unprocessable Entity | 25,723 ms | Rejected generation or walkthrough; exact reason was not recorded. |

A subsequent analysis succeeded in 76,968 ms. Earlier logs contain successful analysis requests as well. They do not include model IDs, token counts, costs, provider finish reasons, or response bodies, so they cannot establish which model was used, whether either 422 was an output-budget exhaustion, or the historical charges. There is no evidence of a host memory failure in these application logs; that is not a host-wide memory audit.

Before this change, OpenRouter and Anthropic requests had an 8,192-token output cap; OpenAI and Gemini had a 12,000-token cap. Long explanations or reasoning could exhaust those budgets. The same HTTP 422 also represented malformed JSON, invalid line ranges, missing files, and incomplete line coverage. Therefore, treating both 422s as proven token exhaustion would be incorrect.

The update adds explicit output/context-limit diagnostics and usage metadata; extends generation timeouts to 180 seconds; reduces repository batches from 40 files to 12 and code sections from roughly 250 lines/20,000 characters to 120 lines/10,000 characters; bounds repeated context; and respects advertised model output limits. No historical usage or cost values are reconstructed or invented.
