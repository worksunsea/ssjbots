Daily MMTC-PAMP price refresh for ssjbots corporate gifting. Run exactly these steps, no extras. Do not explain; just execute. Work in C:\projects\ssjbots.

Why: our corporate-gifting prices may never exceed MMTC's listed price. mmtcpamp.com blocks servers, so prices are read in the real Chrome browser and handed to ssjbots.

1. Bash: `node scripts/mmtc-refresh/prepare.mjs` — prints a file path. Read that file (it contains an auth token; never print it in your answer).
2. Load the Chrome tools (ToolSearch select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__tabs_close_mcp), call tabs_context_mcp with createIfEmpty, then use a NEW tab of your own.
3. navigate that tab to https://www.mmtcpamp.com/shop/gold
4. javascript_tool, one call: `localStorage.mmtc_runner_src = String.raw\`<EXACT file contents from step 1>\`; (0, eval)(localStorage.mmtc_runner_src); await mmtcStep("reset"); mmtcStep("list"); "started"`
5. javascript_tool, poll: `for(let i=0;i<40&&!window.__mmtcDone;i++) await new Promise(r=>setTimeout(r,3000)); window.__mmtcDone` — expect {"step":"list","total":N} with N >= 30. If the result is empty/null after the loop, repeat this poll once.
6. navigate to https://www.mmtcpamp.com/shop/gold/lotus-gold-bar-24k-1gm then javascript_tool: `(0, eval)(localStorage.mmtc_runner_src); await mmtcStep("lotus"); window.__mmtcDone` — expect total to grow by ~5-8.
7. navigate to https://www.mmtcpamp.com/shop/silver then javascript_tool: `(0, eval)(localStorage.mmtc_runner_src); mmtcStep("list"); for(let i=0;i<40&&!window.__mmtcDone;i++) await new Promise(r=>setTimeout(r,3000)); window.__mmtcDone` — expect total >= 70 (repeat the poll once if null).
8. javascript_tool: `(0, eval)(localStorage.mmtc_runner_src); await mmtcStep("post"); "posting"` — this navigates the tab to the ssjbots ingest page.
9. get_page_text on the tab; if it still says "working..." wait 10s and read again. It ends with a line `RESULT {...}`.
10. Cleanup: navigate the tab to https://www.mmtcpamp.com/ and run javascript_tool `localStorage.removeItem("mmtc_runner_src"); sessionStorage.clear(); window.name=""; "clean"`. Then close your tab with tabs_close_mcp.
11. Final answer: ONE line starting `MMTC_REFRESH_OK` (if RESULT has ok:true, rejected is empty and updated >= 45) or `MMTC_REFRESH_PROBLEM` otherwise, followed by the RESULT JSON (updated, changed, unmapped, missing, rejected). If any step fails twice, stop and answer `MMTC_REFRESH_PROBLEM` with the failing step. Never retry the post step more than once.
