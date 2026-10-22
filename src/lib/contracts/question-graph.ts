type QuestionNode = { id: string; applicability: { all: { questionId: string }[] } };
/** Stable Kahn topological ordering; null identifies a dangling dependency or cycle. */
export function orderQuestions<T extends QuestionNode>(questions: T[]): T[] | null {
  const nodes = new Map(questions.map((q) => [q.id, q]));
  const pending = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const q of questions) {
    const dependencies = new Set(q.applicability.all.map((r) => r.questionId));
    pending.set(q.id, dependencies.size);
    for (const dependency of dependencies) {
      if (!nodes.has(dependency)) return null;
      const children = dependents.get(dependency) ?? [];
      children.push(q.id);
      dependents.set(dependency, children);
    }
  }
  const ready = questions.filter((q) => pending.get(q.id) === 0);
  const ordered: T[] = [];
  for (let i = 0; i < ready.length; i++) {
    const q = ready[i];
    ordered.push(q);
    for (const id of dependents.get(q.id) ?? []) {
      const count = pending.get(id)! - 1;
      pending.set(id, count);
      if (count === 0) ready.push(nodes.get(id)!);
    }
  }
  return ordered.length === questions.length ? ordered : null;
}
