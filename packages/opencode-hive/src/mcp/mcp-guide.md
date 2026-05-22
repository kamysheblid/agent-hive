# MCP Server Guide

## Overview

MCP (Model Context Protocol) servers extend agent capabilities with specialized tools. This guide helps you understand and use the available MCPs effectively.

## Quick Reference

| MCP | Best For | Speed | Cost |
|-----|----------|-------|------|
| **websearch** | Current web info | Medium | Free tier |
| **context7** | Library docs | Fast | Free tier |
| **grep_app** | GitHub code patterns | Fast | Free tier |
| **ast_grep** | AST code analysis | Very Fast | Free (Native) |

---

## Detailed MCP Guides

### 1. websearch (Exa AI)

**Purpose**: Real-time web search and information retrieval

**Tools Available**:
- `websearch` - General web search
- `websearch_web_search_exa` - Exa Code API for code-specific search

**Best Use Cases**:
- Finding current information or news
- Searching for tutorials and guides
- Looking up library documentation
- Researching technologies

**Setup**:
```bash
# Optional: Set API key for higher limits
export EXA_API_KEY=your_key_here
```

**Tips**:
- Use specific queries for better results
- Add `site:github.com` to search GitHub specifically
- Use `type: news` for current events

**Example Queries**:
```
"typescript generic constraints best practices"
"react 19 new features 2026"
"site:github.com nextjs app router"
```

---

### 2. context7

**Purpose**: Query official library documentation with up-to-date code examples

**Tools Available**:
- `context7_resolve-library-id` - Resolve library name to Context7 ID
- `context7_query-docs` - Query official documentation

**Best Use Cases**:
- Looking up official library docs
- Finding code examples from official sources
- Understanding API usage for specific libraries

**Supported Libraries** (partial list):
- React, Next.js, Vue, Svelte
- Supabase, Prisma, Drizzle
- Express, Fastify
- TensorFlow, PyTorch
- And 1000+ more

**Setup**:
```bash
# Optional: Set API key for higher limits
export CONTEXT7_API_KEY=your_key_here
```

**Tips**:
- Use specific questions, not just library names
- Include version if known (e.g., `/react/v18`)
- Check library reputation score for quality

**Example**:
```
Query: "How to use useState hook in React with TypeScript"
Library: react
```

---

### 3. grep_app (GitHub Code Search)

**Purpose**: Search production code patterns from over 1M public GitHub repositories

**Tools Available**:
- `grep_app_searchGitHub` - Search code in GitHub repos

**Best Use Cases**:
- Finding real-world code patterns
- Seeing how established projects implement features
- Learning library usage patterns
- Finding examples of specific functions

**Filters**:
- `language` - Filter by programming language
- `repo` - Search specific repository
- `path` - Search within file paths

**Tips**:
- Use regex patterns with `useRegexp=true`
- Filter by language for focused results
- Search for actual code, not keywords

**Example Queries**:
```
'useState('
'async function'
'try {.*await' (with regex)
```

---

### 4. ast_grep (Native NAPI)

**Purpose**: AST-based code analysis and transformation

**Tools Available**:
- `ast_grep_find_code` - Find code matching AST patterns
- `ast_grep_rewrite_code` - Transform/refactor code
- `ast_grep_dump_syntax_tree` - Inspect code structure
- `ast_grep_scan-code` - Scan for TypeScript bugs
- `ast_grep_analyze-imports` - Analyze import usage

**Best Use Cases**:
- Precise code refactoring
- Finding code patterns (not just text)
- Bulk code transformations
- Detecting code quality issues

**Speed**: 52x faster than regex-based tools

**Tips**:
- Use metavariables ($VAR) for flexible matching
- Use `$$$VARS` for multiple nodes
- Test patterns before bulk replacement

**Example Pattern**:
```
# Find console.log calls
console.log($MSG)

# Replace with logger
logger.info($MSG)
```

---

## Choosing the Right MCP

### For Research/Discovery:
1. **websearch** - Current web info (needs API key)
2. **context7** - Library documentation

### For Implementation:
1. **ast_grep** - Code analysis/refactoring
2. **grep_app** - Pattern examples

### For Debugging:
1. **ast_grep** - Scan for issues
2. **grep_app** - Find similar fixes
3. **context7** - API docs

---

## MCP Selection Matrix

| Task | Primary MCP | Alternative |
|------|-------------|-------------|
| Web search | `websearch` | — |
| Library docs | `context7` | `websearch` |
| Code patterns | `grep_app` | `ast_grep` |
| Code analysis | `ast_grep` | `grep_app` |

---

## Troubleshooting

### MCP Not Working?
1. Check if MCP is enabled in config
2. Verify API keys if required
3. Try disabling and re-enabling
4. Check logs for specific errors

### Slow Responses?
- Some MCPs require network calls
- ast_grep is fastest (local)
- Consider caching frequently used queries

### Rate Limits?
- Set API keys for higher limits
- Use free tier for non-critical queries
- Chain queries to minimize calls

---

## Configuration

MCPs can be configured in `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "websearch": {
      "env": {
        "EXA_API_KEY": "your_key"
      }
    },
    "context7": {
      "env": {
        "CONTEXT7_API_KEY": "your_key"
      }
    }
  }
}
```

Disable MCPs in `~/.config/opencode/agent_hive.json`:

```json
{
  "disableMcps": ["grep_app"]
}
```
