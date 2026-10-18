import {
  thoughtLevelInputSchema,
  type ThoughtLevelInput,
  type ThoughtLevelView,
} from "@llm-compare/shared";
import type { AppContext } from "../context.ts";
import { newId, nowIso } from "../db/index.ts";
import { conflict, notFound } from "../errors.ts";
import { ProviderService } from "./providers.ts";

export class MappingService {
  private readonly ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  listLevels(): ThoughtLevelView[] {
    return this.ctx.db.all<ThoughtLevelView>("SELECT id, name, sort FROM thought_levels ORDER BY sort, name");
  }

  level(id: string): ThoughtLevelView {
    const l = this.ctx.db.get<ThoughtLevelView>("SELECT id, name, sort FROM thought_levels WHERE id = ?", id);
    if (!l) throw notFound("思考强度档位");
    return l;
  }

  createLevel(input: ThoughtLevelInput): ThoughtLevelView {
    const v = thoughtLevelInputSchema.parse(input);
    if (this.ctx.db.get("SELECT 1 FROM thought_levels WHERE name = ?", v.name)) throw conflict(`档位名称“${v.name}”已存在`);
    const id = newId();
    this.ctx.db.insert("thought_levels", { id, name: v.name, sort: v.sort, created_at: nowIso() });
    return this.level(id);
  }

  updateLevel(id: string, input: ThoughtLevelInput): ThoughtLevelView {
    this.level(id);
    const v = thoughtLevelInputSchema.parse(input);
    if (this.ctx.db.get("SELECT 1 FROM thought_levels WHERE name = ? AND id != ?", v.name, id)) throw conflict(`档位名称“${v.name}”已存在`);
    this.ctx.db.update("thought_levels", id, { name: v.name, sort: v.sort });
    return this.level(id);
  }

  deleteLevel(id: string): void {
    this.level(id);
    if (new ProviderService(this.ctx).list().some((p) => p.models.some((m) => id in m.thought_levels))) throw conflict("该档位仍被 Provider 模型使用，请先移除映射");
    this.ctx.db.run("DELETE FROM thought_levels WHERE id = ?", id);
  }

}
