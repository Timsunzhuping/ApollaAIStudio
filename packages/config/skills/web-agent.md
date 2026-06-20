---
name: web-agent
triggers: [agent, research with tools, 用工具, 多工具]
tools: [web_search]
risk: read
promptRef: agent.step
executor: agent
---
A multi-tool agent that pursues a goal using available tools. Read-only via the skill path
(writes are refused); use the dedicated agent flow for confirmed low-risk writes.
