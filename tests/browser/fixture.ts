export const port = Number(process.env.MIRA_TEST_PORT ?? 8791);
export const baseURL = `http://localhost:${port}`;
export const adminToken = "mira-browser-test-token";
export const replyPrefix = "本地验收回复";
export const cancellationPrompt = "等待停止验证";
export const retryPromptPrefix = "重试验收";
export const scrollPrompt = "长回复滚动验收";
export const imageProfile = "图片验收";
export const richPrompt = "公式代码图表验收";
export const richReply = [
  "行内公式 $E=mc^2$。",
  "$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$",
  '```typescript\nconst greeting: string = "你好";\nconsole.log(greeting);\n```',
  '```python\nprint("<img src=x onerror=alert(1)>")\n```',
  "```mermaid\ngraph LR\n A[输入] --> B[处理] --> C[结果]\n```",
  "```mermaid\nunsupported diagram source\n```",
  "富文本验收完成。",
].join("\n\n");
