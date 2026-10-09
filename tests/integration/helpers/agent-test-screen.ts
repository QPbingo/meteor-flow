// A ready signal from herdr is not proof that the CLI is accepting task input.
// Stop these opt-in tests instead of answering any interactive prompt.
export function screenBlocker(text: string): string | null {
  // Claude 2.1.195 renders this exact Homebrew notice as a passive footer.
  // Remove only that whole line; nearby menus, approvals and active updates
  // still pass through every blocker below.
  text = text.split('\n').filter(line => line.trim() !== 'Update available! Run: brew upgrade claude-code').join('\n');
  for (const [pattern, message] of [
    [/trust.*(?:directory|folder)|trust the contents|trust this project/i, 'directory trust requires human confirmation'],
    [/select.*(?:theme|text style)|choose.*(?:theme|text style)|let.s get started/i, 'first-run onboarding requires human interaction'],
    [/sign in|log in|login|authentication required/i, 'interactive login is required'],
    [/do you want to proceed|allow command|waiting for permission|would you like to run|approve this command|requires approval/i, 'tool permission requires human confirmation'],
    [/not logged in|invalid.*(?:token|api key)|authentication failed/i, 'authentication unavailable in the isolated environment'],
    [/update available|update now|updating codex|brew\s+(?:upgrade|update)|upgrade.*codex|^[ \t]*Updating(?: via [^\n]+)?(?:…|\.{3})[ \t]*$/im, 'software update requires human interaction'],
    [/sandbox_apply|operation not permitted|permission denied|沙箱阻止|等待.{0,40}(?:恢复.*权限|授权)/i, 'execution sandbox or permission is unavailable'],
    [/cannot use the shared background server|api_key_model_discovery/i, 'Codex shared background server is incompatible with this session'],
  ] as const) if (pattern.test(text)) return message;
  return null;
}

// The task may spend time queued/preparing after an earlier readiness check.
// Guard the actual external input boundary and keep it closed after any blocker.
export function guardAgentInput<T extends { prompt(target: string, text: string): Promise<void> }>(
  port: T,
  readScreen: (target: string) => Promise<string>,
  onBlocked: (reason: string) => void,
) {
  let blockedReason: string | null = null;
  const stop = (reason: string) => {
    if (blockedReason) return;
    blockedReason = reason;
    onBlocked(reason);
  };
  const send = port.prompt.bind(port);
  port.prompt = async (target, text) => {
    if (blockedReason) throw new Error(blockedReason);
    let screen: string;
    try { screen = await readScreen(target); }
    catch (error) { stop('cannot verify the terminal screen before task input'); throw error; }
    const reason = screenBlocker(screen);
    if (reason) stop(reason);
    if (blockedReason) throw new Error(blockedReason);
    await send(target, text);
  };
  return { port, stop, get blockedReason() { return blockedReason; } };
}
