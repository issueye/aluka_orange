# -*- coding: utf-8 -*-
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "docs"
root.mkdir(exist_ok=True)

arch = r'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1180" width="1600" height="1180" role="img" aria-labelledby="title desc">
  <title id="title">Aluka Architecture</title>
  <desc id="desc">Four-layer Aluka runtime, pi plugin contract, and one agent turn.</desc>
  <defs>
    <style>
      @import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&amp;family=Noto+Serif+SC:wght@600;700&amp;family=Syne:wght@800&amp;display=swap");
      .word { font-family: Syne, Impact, sans-serif; font-weight: 800; fill: #f3ead8; }
      .serif { font-family: "Noto Serif SC", "Songti SC", "Palatino Linotype", serif; fill: #f3ead8; }
      .mono { font-family: "IBM Plex Mono", Consolas, monospace; fill: #c9b89a; }
      .muted { fill: #8d8173; }
      .ink { fill: #f3ead8; }
      .copper { fill: #e08a3c; }
      .sage { fill: #8fbfa8; }
    </style>
    <pattern id="grain" width="6" height="6" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.6" fill="#f3ead8" opacity="0.05"/>
      <circle cx="4" cy="3.5" r="0.45" fill="#000" opacity="0.18"/>
    </pattern>
    <linearGradient id="band" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#2a241c"/>
      <stop offset="1" stop-color="#1e1a15"/>
    </linearGradient>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M0 1.2 L10 5 L0 8.8 Z" fill="#e08a3c"/>
    </marker>
  </defs>

  <rect width="1600" height="1180" fill="#16120e"/>
  <rect width="1600" height="1180" fill="url(#grain)"/>
  <rect x="28" y="28" width="1544" height="1124" fill="none" stroke="#3a3228"/>
  <rect x="36" y="36" width="1528" height="1108" fill="none" stroke="#e08a3c" stroke-width="0.6" opacity="0.45"/>

  <text class="mono muted" x="64" y="78" font-size="12">ALUKA  ·  DOCS/ARCHITECTURE  ·  01</text>
  <text class="word" x="64" y="128" font-size="52">ARCHITECTURE</text>
  <text class="serif" x="64" y="162" font-size="20">__ARCH_SUB__</text>
  <g transform="translate(1140,58)">
    <rect width="396" height="108" rx="2" fill="#211c16" stroke="#e08a3c" stroke-width="1.2"/>
    <text class="mono copper" x="18" y="28" font-size="11">COMPAT STAMP</text>
    <text class="serif ink" x="18" y="56" font-size="16">__STAMP_1__</text>
    <text class="mono muted" x="18" y="82" font-size="11">export default function (pi)</text>
  </g>

  <text class="mono copper" x="64" y="214" font-size="12">01  LAYERS</text>

  <g transform="translate(64,230)">
    <rect width="980" height="92" rx="4" fill="url(#band)" stroke="#c9b89a"/>
    <rect width="8" height="92" fill="#e08a3c"/>
    <text class="mono copper" x="28" y="28" font-size="12">L4  ENTRY</text>
    <text class="serif ink" x="28" y="54" font-size="20">CLI / REPL / Print</text>
    <g transform="translate(360,34)"><rect width="140" height="28" rx="2" fill="#16120e" stroke="#5a4e40"/><text class="mono ink" x="10" y="19" font-size="11">src/cli.ts</text></g>
    <g transform="translate(512,34)"><rect width="148" height="28" rx="2" fill="#16120e" stroke="#5a4e40"/><text class="mono ink" x="10" y="19" font-size="11">src/main.ts</text></g>
    <g transform="translate(672,34)"><rect width="148" height="28" rx="2" fill="#16120e" stroke="#5a4e40"/><text class="mono ink" x="10" y="19" font-size="11">src/config.ts</text></g>
    <text class="mono muted" x="28" y="78" font-size="11">__L4__</text>
  </g>

  <g transform="translate(64,338)">
    <rect width="980" height="132" rx="4" fill="url(#band)" stroke="#c9b89a"/>
    <rect width="8" height="132" fill="#8fbfa8"/>
    <text class="mono sage" x="28" y="26" font-size="12">L3  HARNESS</text>
    <text class="serif ink" x="28" y="52" font-size="20">__L3_TITLE__</text>
    <g font-size="11" class="mono">
      <g transform="translate(28,68)"><rect width="172" height="44" rx="2" fill="#16120e" stroke="#5a4e40"/><text class="ink" x="10" y="18">extensions/</text><text class="muted" x="10" y="34">loader runner types</text></g>
      <g transform="translate(212,68)"><rect width="148" height="44" rx="2" fill="#16120e" stroke="#5a4e40"/><text class="ink" x="10" y="18">tools/</text><text class="muted" x="10" y="34">read write edit bash</text></g>
      <g transform="translate(372,68)"><rect width="148" height="44" rx="2" fill="#16120e" stroke="#5a4e40"/><text class="ink" x="10" y="18">session/</text><text class="muted" x="10" y="34">JSONL persist</text></g>
      <g transform="translate(532,68)"><rect width="148" height="44" rx="2" fill="#16120e" stroke="#5a4e40"/><text class="ink" x="10" y="18">skills/</text><text class="muted" x="10" y="34">SKILL.md</text></g>
      <g transform="translate(692,68)"><rect width="260" height="44" rx="2" fill="#16120e" stroke="#5a4e40"/><text class="ink" x="10" y="18">system-prompt.ts</text><text class="muted" x="10" y="34">cwd + tools + skills</text></g>
    </g>
  </g>

  <g transform="translate(64,486)">
    <rect width="980" height="92" rx="4" fill="url(#band)" stroke="#c9b89a"/>
    <rect width="8" height="92" fill="#c9b89a"/>
    <text class="mono muted" x="28" y="28" font-size="12">L2  AGENT CORE</text>
    <text class="serif ink" x="28" y="54" font-size="20">Tool Loop  ·  Events  ·  Abort</text>
    <g transform="translate(420,34)"><rect width="196" height="28" rx="2" fill="#16120e" stroke="#5a4e40"/><text class="mono ink" x="10" y="19" font-size="11">src/agent/loop.ts</text></g>
    <g transform="translate(628,34)"><rect width="204" height="28" rx="2" fill="#16120e" stroke="#5a4e40"/><text class="mono ink" x="10" y="19" font-size="11">src/agent/types.ts</text></g>
    <text class="mono muted" x="28" y="78" font-size="11">stream → toolCall → execute → toolResult → stop when idle</text>
  </g>

  <g transform="translate(64,594)">
    <rect width="980" height="92" rx="4" fill="url(#band)" stroke="#c9b89a"/>
    <rect width="8" height="92" fill="#6b8cae"/>
    <text class="mono" x="28" y="28" font-size="12" fill="#8aa4c2">L1  AI</text>
    <text class="serif ink" x="28" y="54" font-size="20">Provider-agnostic stream</text>
    <g transform="translate(380,34)"><rect width="168" height="28" rx="2" fill="#16120e" stroke="#5a4e40"/><text class="mono ink" x="10" y="19" font-size="11">ai/openai.ts</text></g>
    <g transform="translate(560,34)"><rect width="188" height="28" rx="2" fill="#16120e" stroke="#5a4e40"/><text class="mono ink" x="10" y="19" font-size="11">ai/anthropic.ts</text></g>
    <g transform="translate(760,34)"><rect width="188" height="28" rx="2" fill="#16120e" stroke="#5a4e40"/><text class="mono ink" x="10" y="19" font-size="11">ai/stream.ts</text></g>
    <text class="mono muted" x="28" y="78" font-size="11">OpenAI-compatible + Anthropic Messages · TypeBox → JSON Schema</text>
  </g>

  <g transform="translate(1072,230)">
    <text class="mono copper" x="0" y="-16" font-size="12">02  PLUGIN CONTRACT</text>
    <rect width="464" height="456" rx="4" fill="#211c16" stroke="#3a3228"/>
    <text class="serif ink" x="24" y="40" font-size="18">__DISC__</text>
    <g class="mono" font-size="12">
      <text fill="#8fbfa8" x="24" y="72">~/.pi/agent/extensions/</text>
      <text fill="#c9b89a" x="24" y="94">~/.aluka/agent/extensions/</text>
      <text fill="#8fbfa8" x="24" y="116">.pi/extensions/   .aluka/extensions/</text>
      <text class="muted" x="24" y="138">settings.json  extensions[]   -e path.ts</text>
    </g>
    <line x1="24" y1="158" x2="440" y2="158" stroke="#3a3228"/>
    <text class="serif ink" x="24" y="188" font-size="18">__ALIAS__</text>
    <g class="mono" font-size="11">
      <text fill="#e08a3c" x="24" y="216">@earendil-works/pi-coding-agent</text>
      <text class="muted" x="24" y="234">@mariozechner/pi-coding-agent  →  src/index.ts</text>
      <text fill="#8fbfa8" x="24" y="260">@*/pi-agent-core  →  src/agent</text>
      <text fill="#8fbfa8" x="24" y="280">@*/pi-ai          →  src/ai</text>
      <text fill="#8fbfa8" x="24" y="300">@*/pi-tui         →  src/tui  (stub)</text>
      <text class="muted" x="24" y="320">typebox  /  @sinclair/typebox</text>
    </g>
    <line x1="24" y1="340" x2="440" y2="340" stroke="#3a3228"/>
    <text class="serif ink" x="24" y="370" font-size="18">ExtensionAPI</text>
    <text class="mono ink" x="24" y="398" font-size="12">pi.on  ·  registerTool  ·  registerCommand</text>
    <text class="mono muted" x="24" y="420" font-size="12">registerProvider  ·  sendMessage  ·  exec</text>
    <text class="mono muted" x="24" y="442" font-size="12">ctx.ui.notify / confirm / select / input</text>
  </g>

  <text class="mono copper" x="64" y="728" font-size="12">03  ONE TURN</text>
  <rect x="64" y="742" width="1472" height="196" rx="4" fill="#211c16" stroke="#3a3228"/>
  <g font-size="12" class="mono">
    <g transform="translate(88,778)"><rect width="118" height="52" rx="3" fill="#16120e" stroke="#e08a3c"/><text class="copper" x="12" y="22">PROMPT</text><text class="muted" x="12" y="40">input event</text></g>
    <line x1="206" y1="804" x2="236" y2="804" stroke="#e08a3c" marker-end="url(#arrow)"/>
    <g transform="translate(244,778)"><rect width="150" height="52" rx="3" fill="#16120e" stroke="#5a4e40"/><text class="ink" x="12" y="22">before_start</text><text class="muted" x="12" y="40">systemPrompt</text></g>
    <line x1="394" y1="804" x2="424" y2="804" stroke="#e08a3c" marker-end="url(#arrow)"/>
    <g transform="translate(432,778)"><rect width="130" height="52" rx="3" fill="#16120e" stroke="#5a4e40"/><text class="ink" x="12" y="22">context</text><text class="muted" x="12" y="40">rewrite msgs</text></g>
    <line x1="562" y1="804" x2="592" y2="804" stroke="#e08a3c" marker-end="url(#arrow)"/>
    <g transform="translate(600,778)"><rect width="150" height="52" rx="3" fill="#16120e" stroke="#8fbfa8"/><text fill="#8fbfa8" x="12" y="22">streamModel</text><text class="muted" x="12" y="40">L1 provider</text></g>
    <line x1="750" y1="804" x2="780" y2="804" stroke="#e08a3c" marker-end="url(#arrow)"/>
    <g transform="translate(788,778)"><rect width="150" height="52" rx="3" fill="#16120e" stroke="#e08a3c"/><text class="copper" x="12" y="22">tool_call</text><text class="muted" x="12" y="40">block | mutate</text></g>
    <line x1="938" y1="804" x2="968" y2="804" stroke="#e08a3c" marker-end="url(#arrow)"/>
    <g transform="translate(976,778)"><rect width="130" height="52" rx="3" fill="#16120e" stroke="#5a4e40"/><text class="ink" x="12" y="22">execute</text><text class="muted" x="12" y="40">wrapTool</text></g>
    <line x1="1106" y1="804" x2="1136" y2="804" stroke="#e08a3c" marker-end="url(#arrow)"/>
    <g transform="translate(1144,778)"><rect width="150" height="52" rx="3" fill="#16120e" stroke="#5a4e40"/><text class="ink" x="12" y="22">tool_result</text><text class="muted" x="12" y="40">patch output</text></g>
    <line x1="1294" y1="804" x2="1324" y2="804" stroke="#e08a3c" marker-end="url(#arrow)"/>
    <g transform="translate(1332,778)"><rect width="172" height="52" rx="3" fill="#16120e" stroke="#8fbfa8"/><text fill="#8fbfa8" x="12" y="22">loop / done</text><text class="muted" x="12" y="40">agent_end</text></g>
  </g>
  <text class="serif muted" x="88" y="872" font-size="15">__TURN_NOTE__</text>
  <text class="mono muted" x="88" y="900" font-size="12">builtinTools  ∪  extension.tools   ·   session JSONL  ·   skills markdown</text>
  <text class="mono muted" x="64" y="1136" font-size="11">ALUKA  ·  NOT A FORK  ·  SAME PLUGIN SURFACE  ·  SEE docs/roadmap.svg</text>
  <text class="mono copper" x="1280" y="1136" font-size="11">v0.1.0</text>
</svg>
'''

road = r'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1240" width="1600" height="1240" role="img" aria-labelledby="title desc">
  <title id="title">Aluka Code Roadmap</title>
  <desc id="desc">Shipped file map plus Next and Later work ordered by dependency.</desc>
  <defs>
    <style>
      @import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&amp;family=Noto+Serif+SC:wght@600;700&amp;family=Syne:wght@800&amp;display=swap");
      .word { font-family: Syne, Impact, sans-serif; font-weight: 800; fill: #f3ead8; }
      .serif { font-family: "Noto Serif SC", "Songti SC", "Palatino Linotype", serif; fill: #f3ead8; }
      .mono { font-family: "IBM Plex Mono", Consolas, monospace; }
    </style>
    <pattern id="grain" width="6" height="6" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.55" fill="#f3ead8" opacity="0.05"/>
      <circle cx="4" cy="3.5" r="0.4" fill="#000" opacity="0.2"/>
    </pattern>
  </defs>

  <rect width="1600" height="1240" fill="#16120e"/>
  <rect width="1600" height="1240" fill="url(#grain)"/>
  <rect x="28" y="28" width="1544" height="1184" fill="none" stroke="#3a3228"/>
  <rect x="36" y="36" width="1528" height="1168" fill="none" stroke="#e08a3c" stroke-width="0.6" opacity="0.45"/>

  <text class="mono" x="64" y="78" font-size="12" fill="#8d8173">ALUKA  ·  DOCS/ROADMAP  ·  02</text>
  <text class="word" x="64" y="128" font-size="52">CODE ROADMAP</text>
  <text class="serif" x="64" y="162" font-size="20">__ROAD_SUB__</text>

  <g transform="translate(1140,58)">
    <rect width="396" height="108" rx="2" fill="#211c16" stroke="#8fbfa8" stroke-width="1.2"/>
    <text class="mono" x="18" y="28" font-size="11" fill="#8fbfa8">NORTH STAR</text>
    <text class="serif" x="18" y="56" font-size="15" fill="#f3ead8">__STAR__</text>
    <text class="mono" x="18" y="82" font-size="11" fill="#8d8173">TUI parity is later, not now</text>
  </g>

  <g transform="translate(64,214)">
    <rect width="480" height="760" rx="4" fill="#211c16" stroke="#8fbfa8"/>
    <rect width="480" height="56" rx="4" fill="#1a2a22"/>
    <rect y="40" width="480" height="16" fill="#1a2a22"/>
    <text class="mono" x="24" y="36" font-size="13" fill="#8fbfa8">NOW  ·  SHIPPED  ·  v0.1</text>
    <text class="serif" x="24" y="92" font-size="20" fill="#f3ead8">__NOW_T__</text>
    <text class="mono" x="24" y="118" font-size="12" fill="#8d8173">tests 6/6  ·  layers in place</text>
    <g class="mono" font-size="12">
      <g transform="translate(24,146)"><text fill="#8fbfa8" y="0">__NOW_1__</text><text fill="#c9b89a" y="22">src/cli.ts          src/main.ts</text><text fill="#c9b89a" y="42">src/index.ts        src/config.ts</text></g>
      <g transform="translate(24,214)"><text fill="#8fbfa8" y="0">AI + Loop</text><text fill="#c9b89a" y="22">src/ai/openai.ts    anthropic.ts</text><text fill="#c9b89a" y="42">src/ai/stream.ts    schema.ts</text><text fill="#c9b89a" y="62">src/agent/loop.ts   types.ts</text></g>
      <g transform="translate(24,302)"><text fill="#8fbfa8" y="0">__NOW_3__</text><text fill="#c9b89a" y="22">extensions/loader.ts   jiti + alias</text><text fill="#c9b89a" y="42">extensions/runner.ts   emit / wrapTool</text><text fill="#c9b89a" y="62">extensions/types.ts    ExtensionAPI</text></g>
      <g transform="translate(24,390)"><text fill="#8fbfa8" y="0">__NOW_4__</text><text fill="#c9b89a" y="22">tools/{files,bash,search}.ts</text><text fill="#c9b89a" y="42">session/manager.ts     JSONL</text><text fill="#c9b89a" y="62">skills/index.ts        SKILL.md</text></g>
      <g transform="translate(24,478)"><text fill="#8fbfa8" y="0">__NOW_5__</text><text fill="#c9b89a" y="22">tests/extensions.test.ts</text><text fill="#c9b89a" y="42">tests/examples.test.ts   greet.ts</text><text fill="#c9b89a" y="62">tests/agent-loop.test.ts</text></g>
    </g>
    <rect x="24" y="680" width="432" height="52" fill="#16120e" stroke="#3a3228"/>
    <text class="serif" x="40" y="712" font-size="15" fill="#8fbfa8">__NOW_F__</text>
  </g>

  <g transform="translate(560,214)">
    <rect width="480" height="760" rx="4" fill="#211c16" stroke="#e08a3c"/>
    <rect width="480" height="56" fill="#2a2118" rx="4"/>
    <rect y="40" width="480" height="16" fill="#2a2118"/>
    <text class="mono" x="24" y="36" font-size="13" fill="#e08a3c">NEXT  ·  BUILD</text>
    <text class="serif" x="24" y="92" font-size="20" fill="#f3ead8">__NEXT_T__</text>
    <text class="mono" x="24" y="118" font-size="12" fill="#8d8173">__NEXT_S__</text>
    <g class="mono" font-size="12">
      <g transform="translate(24,146)"><text fill="#e08a3c" y="0">1. Provider lifecycle</text><text fill="#c9b89a" y="22">src/models.ts → ModelRegistry</text><text fill="#8d8173" y="42">registerProvider live + OAuth</text></g>
      <g transform="translate(24,214)"><text fill="#e08a3c" y="0">2. Compaction</text><text fill="#c9b89a" y="22">src/compaction/index.ts  NEW</text><text fill="#8d8173" y="42">session_before_compact</text></g>
      <g transform="translate(24,282)"><text fill="#e08a3c" y="0">3. Parallel tools</text><text fill="#c9b89a" y="22">src/agent/loop.ts  executionMode</text><text fill="#8d8173" y="42">sequential | parallel batches</text></g>
      <g transform="translate(24,350)"><text fill="#e08a3c" y="0">4. Session tree</text><text fill="#c9b89a" y="22">session/manager.ts  fork / tree</text><text fill="#8d8173" y="42">newSession · switchSession</text></g>
      <g transform="translate(24,418)"><text fill="#e08a3c" y="0">5. Interactive mode</text><text fill="#c9b89a" y="22">src/modes/interactive.ts  NEW</text><text fill="#8d8173" y="42">stream render · slash · abort</text></g>
      <g transform="translate(24,486)"><text fill="#e08a3c" y="0">6. UI primitives</text><text fill="#c9b89a" y="22">extensions/ui.ts  +  tui/</text><text fill="#8d8173" y="42">setWidget / setFooter / editor</text></g>
      <g transform="translate(24,554)"><text fill="#e08a3c" y="0">7. Trust + settings</text><text fill="#c9b89a" y="22">src/trust.ts  src/settings.ts</text><text fill="#8d8173" y="42">project_trust · enabledModels</text></g>
    </g>
    <rect x="24" y="680" width="432" height="52" fill="#16120e" stroke="#3a3228"/>
    <text class="serif" x="40" y="712" font-size="15" fill="#e08a3c">__NEXT_F__</text>
  </g>

  <g transform="translate(1056,214)">
    <rect width="480" height="760" rx="4" fill="#211c16" stroke="#3a3228"/>
    <rect width="480" height="56" fill="#1a1815" rx="4"/>
    <rect y="40" width="480" height="16" fill="#1a1815"/>
    <text class="mono" x="24" y="36" font-size="13" fill="#8d8173">LATER  ·  PARITY</text>
    <text class="serif" x="24" y="92" font-size="20" fill="#f3ead8">__LATER_T__</text>
    <text class="mono" x="24" y="118" font-size="12" fill="#8d8173">__LATER_S__</text>
    <g class="mono" font-size="12">
      <g transform="translate(24,146)"><text fill="#c9b89a" y="0">Real pi-tui components</text><text fill="#8d8173" y="22">src/tui/  replace stub</text><text fill="#8d8173" y="42">ctx.ui.custom() works</text></g>
      <g transform="translate(24,214)"><text fill="#c9b89a" y="0">Package manager</text><text fill="#8d8173" y="22">npm: / git:  pi packages</text></g>
      <g transform="translate(24,260)"><text fill="#c9b89a" y="0">RPC / JSON modes</text><text fill="#8d8173" y="22">src/modes/{rpc,print,json}.ts</text></g>
      <g transform="translate(24,306)"><text fill="#c9b89a" y="0">Themes / markdown render</text><text fill="#8d8173" y="22">registerMessageRenderer</text></g>
      <g transform="translate(24,352)"><text fill="#c9b89a" y="0">Via extensions, not core</text><text fill="#8d8173" y="22">MCP · sub-agent · plan mode</text></g>
      <g transform="translate(24,420)"><text fill="#c9b89a" y="0">Binary distribution</text><text fill="#8d8173" y="22">bun compile · virtualModules</text></g>
    </g>
    <rect x="24" y="680" width="432" height="52" fill="#16120e" stroke="#3a3228"/>
    <text class="serif" x="40" y="712" font-size="15" fill="#8d8173">__LATER_F__</text>
  </g>

  <g transform="translate(64,1000)">
    <text class="mono" x="0" y="0" font-size="12" fill="#e08a3c">DEPENDENCY ORDER</text>
    <rect y="16" width="1472" height="88" rx="4" fill="#211c16" stroke="#3a3228"/>
    <g class="mono" font-size="13">
      <text fill="#8fbfa8" x="24" y="52">types/schema</text>
      <text fill="#e08a3c" x="168" y="52">→</text>
      <text fill="#f3ead8" x="196" y="52">ai stream</text>
      <text fill="#e08a3c" x="308" y="52">→</text>
      <text fill="#f3ead8" x="336" y="52">agent loop</text>
      <text fill="#e08a3c" x="456" y="52">→</text>
      <text fill="#f3ead8" x="484" y="52">wrapTool + events</text>
      <text fill="#e08a3c" x="668" y="52">→</text>
      <text fill="#f3ead8" x="696" y="52">ModelRegistry</text>
      <text fill="#e08a3c" x="844" y="52">→</text>
      <text fill="#f3ead8" x="872" y="52">compaction</text>
      <text fill="#e08a3c" x="996" y="52">→</text>
      <text fill="#f3ead8" x="1024" y="52">session tree</text>
      <text fill="#e08a3c" x="1164" y="52">→</text>
      <text fill="#f3ead8" x="1192" y="52">TUI / packages</text>
    </g>
    <text class="mono" x="24" y="84" font-size="11" fill="#8d8173">__DEP_NOTE__</text>
  </g>

  <text class="mono" x="64" y="1196" font-size="11" fill="#8d8173">ALUKA  ·  THIN CORE  ·  EXTENSIONS FIRST  ·  SEE docs/architecture.svg</text>
  <text class="mono" x="1280" y="1196" font-size="11" fill="#e08a3c">v0.1.0 → 0.2</text>
</svg>
'''

replacements = {
    "__ARCH_SUB__": "四层运行时  ·  与 pi-agent 插件契约对齐",
    "__STAMP_1__": "不 fork pi，实现同一 ExtensionAPI",
    "__L4__": "解析参数 · 启动会话 · 交互循环 / 一次性 -p",
    "__L3_TITLE__": "编码运行时  ·  扩展 / 工具 / 会话 / 技能",
    "__DISC__": "发现路径（与 pi 共用）",
    "__ALIAS__": "jiti 别名（加载时改写）",
    "__TURN_NOTE__": "同名扩展工具覆盖内置工具。拦截发生在 wrapTool，而不是改 loop。",
    "__ROAD_SUB__": "按文件推进  ·  先兼容插件，再补齐运行时深度",
    "__STAR__": "现有 pi 插件可加载、可拦截、可注册工具",
    "__NOW_T__": "可运行的兼容内核",
    "__NOW_1__": "骨架",
    "__NOW_3__": "插件系统",
    "__NOW_4__": "内置工具 + 会话",
    "__NOW_5__": "验证",
    "__NOW_F__": "现状：工具 / 命令 / 事件门可跑",
    "__NEXT_T__": "补齐运行时深度",
    "__NEXT_S__": "让更多真实 pi 插件不再撞 stub",
    "__NEXT_F__": "目标：主流事件处理器不再 no-op",
    "__LATER_T__": "接近 pi 的完整 harness",
    "__LATER_S__": "只在契约稳定后再做",
    "__LATER_F__": "原则：核心保持薄，能力外置",
    "__DEP_NOTE__": "不要先做 TUI。先让 registerProvider / compact / fork 的事件契约可测。",
}

for key, value in replacements.items():
    arch = arch.replace(key, value)
    road = road.replace(key, value)

(root / "architecture.svg").write_text(arch, encoding="utf-8")
(root / "roadmap.svg").write_text(road, encoding="utf-8")
print("wrote", root / "architecture.svg")
print("wrote", root / "roadmap.svg")
