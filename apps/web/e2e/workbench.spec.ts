import type { LibraryItemView, ProjectView, AgentConfigView, MessageView, ModelOptionView, RunPacket } from "@llm-compare/shared"
import { expect, test, type Page } from "@playwright/test"
import { settings } from "./settings.ts"

function observeErrors(page: Page) {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()) })
  return errors
}

async function select(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click()
  // Radix 下拉内容通过 Portal 渲染，不能限定在 dialog 内查找选项。
  const item = label === "Agent 配置"
    ? page.getByRole("option").filter({ has: page.getByText(option, { exact: true }) })
    : page.getByRole("option", { name: option, exact: true })
  if (label === "Agent 配置") await expect(item).toContainText(/干净 · 已验证|干净 · 未验证|全局环境/)
  await item.click()
}

async function get<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`/api/v1${path}`)
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json() as Promise<T>
}

async function modelName(page: Page, agentName: string, value: string) {
  const { items: agents } = await get<{ items: AgentConfigView[] }>(page, "/agent-configs")
  const matches = agents.filter((a) => a.name === agentName)
  expect(matches, `Agent 名称必须唯一：${agentName}`).toHaveLength(1)
  expect(matches[0].available, matches[0].unavailable_reasons.join("；")).toBe(true)
  const { items: models } = await get<{ items: ModelOptionView[] }>(page, `/agent-configs/${matches[0].id}/models`)
  const model = models.find((m) => m.value === value)
  expect(model, `Agent 未列出模型：${value}`).toBeDefined()
  return model!.name
}

async function createProject(page: Page, title: string, prompt: string) {
  await page.goto("/")
  await page.getByRole("button", { name: "新建项目", exact: true }).first().click()
  await page.getByLabel("项目名称", { exact: true }).fill(title)
  await page.getByRole("button", { name: "创建", exact: true }).click()
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible()
  await expect(page.getByText("还没有运行", { exact: true })).toBeVisible()
  await page.getByLabel("素材", { exact: true }).fill("校验词：验收通过😀。特殊字符：<&>、中文与换行。\n所有对象接收相同素材。")
  await page.getByLabel("提示词", { exact: true }).fill(prompt)
  await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible()
  const id = new URL(page.url()).pathname.split("/")[2]
  const saved = await get<{ draft_prompt: string }>(page, `/projects/${id}`)
  expect(saved.draft_prompt).toBe(prompt)
  return id
}

async function startRun(page: Page) {
  const created = page.waitForResponse((r) => r.request().method() === "POST" && /\/projects\/[^/]+\/runs$/.test(new URL(r.url()).pathname))
  await page.getByRole("button", { name: "运行", exact: true }).click()
  const response = await created
  expect(response.status(), await response.text()).toBe(201)
  const run = await response.json() as RunPacket
  expect(run.comparison.require_clean).toBe(run.targets.every((t) => t.snapshot.kind === "provider" || (t.snapshot.config.home_mode === "clean" && t.snapshot.config.clean_status === "verified")))
  return run
}

async function completeRun(page: Page, id: string, count: number) {
  let result: RunPacket | undefined
  await expect.poll(async () => {
    result = await get<RunPacket>(page, `/runs/${id}`)
    if (["failed", "partial", "cancelled"].includes(result.status)) {
      throw new Error(JSON.stringify(result.targets.map((t) => t.attempts.map((a) => ({ status: a.status, error: a.error })))))
    }
    return result.status
  }, { timeout: settings.timeoutMs, intervals: [500, 1000, 2000] }).toBe("succeeded")
  expect(result!.targets).toHaveLength(count)
  for (const target of result!.targets) {
    const attempt = target.attempts.at(-1)!
    expect(attempt.output_text.trim()).not.toBe("")
    expect(attempt.readonly_check).toBe(target.snapshot.kind === "provider" ? null : "passed")
    expect(attempt.timing.total_ms).toBeGreaterThan(0)
  }
  // 页面无刷新即可显示终态，验证真实 SSE 更新。
  await expect(page.getByRole("button", { name: "重试", exact: true })).toHaveCount(count)
  await expect(page.getByText("验收通过😀", { exact: true })).toHaveCount(count)
  return result!
}

test("真实 Agent：新建项目、草稿、轮次、历史、分析侧栏", async ({ page }, info) => {
  const errors = observeErrors(page)
  const title = `E2E 单对象 ${Date.now()}`
  const projectId = await createProject(page, title, "只回复素材中的校验词（含表情，不含句号），不要解释、Markdown 或调用工具。")
  const name = await modelName(page, settings.run.agentName, settings.run.modelValue)
  await select(page, "Agent 配置", settings.run.agentName)
  await select(page, "模型", name)
  await select(page, "思考强度", settings.run.thoughtLevelName)
  await page.getByRole("button", { name: "添加到对比", exact: true }).click()
  const run = await startRun(page)
  await completeRun(page, run.id, 1)
  await page.getByRole("tab", { name: "历史", exact: true }).click()
  await page.getByRole("link").filter({ hasText: "第 1 轮" }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/runs/${run.id}$`))
  await page.reload()
  await expect(page.getByRole("button", { name: "重试", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "分析", exact: true }).click()
  await page.getByRole("button", { name: "新会话", exact: true }).click()
  const analysisModel = await modelName(page, settings.analysis.agentName, settings.analysis.modelValue)
  await select(page, "分析用 Agent", settings.analysis.agentName)
  await select(page, "分析模型", analysisModel)
  await select(page, "分析思考强度", settings.analysis.thoughtLevelName)
  await page.getByRole("button", { name: "创建会话", exact: true }).click()
  await page.getByLabel("分析要求", { exact: true }).fill("读取关联记录的快照，用一句中文说明本轮返回了什么，不要修改文件。")
  const sent = page.waitForResponse((r) => r.request().method() === "POST" && /\/conversations\/[^/]+\/messages$/.test(new URL(r.url()).pathname))
  await page.getByRole("button", { name: "发送", exact: true }).click()
  const response = await sent
  expect(response.status(), await response.text()).toBe(201)
  const path = new URL(response.url()).pathname.replace("/api/v1", "")
  await expect.poll(async () => {
    const { items } = await get<{ items: MessageView[] }>(page, path)
    const assistant = items.find((m) => m.role === "assistant")
    if (assistant?.status === "failed") throw new Error(assistant.error ?? "分析失败")
    return assistant?.status
  }, { timeout: settings.timeoutMs, intervals: [500, 1000, 2000] }).toBe("succeeded")
  const sheet = page.getByRole("dialog", { name: "按需分析", exact: true })
  await expect(sheet.getByRole("alert")).toHaveCount(0)
  await expect(sheet.getByText("读取关联记录的快照，用一句中文说明本轮返回了什么，不要修改文件。", { exact: true })).toBeVisible()
  await expect(sheet.getByText("完成", { exact: true })).toBeVisible()
  await expect(sheet.getByText(/引用来源（1）/)).toBeVisible()
  await expect(sheet.getByRole("button", { name: "发送", exact: true })).toBeDisabled()
  await page.screenshot({ path: info.outputPath("analysis-complete.png") })
  expect(errors).toEqual([])
})

test("真实 Agent：跨 Agent 跨模型自由对比", async ({ page }, info) => {
  const errors = observeErrors(page)
  await createProject(page, `E2E 自由对比 ${Date.now()}`, "只回复素材中的校验词（含表情，不含句号），不要解释、Markdown 或调用工具。")
  await expect(page.getByRole("switch", { name: "要求干净环境", exact: true })).toHaveCount(0)
  for (const target of settings.comparison.targets) {
    await select(page, "Agent 配置", target.agentName)
    await select(page, "模型", await modelName(page, target.agentName, target.modelValue))
    await select(page, "思考强度", target.thoughtLevelName)
    await page.getByRole("button", { name: "添加到对比", exact: true }).click()
  }
  // 未提交的完整选择不应悄悄成为第三个运行对象。
  const unsubmitted = settings.comparison.targets[0]
  await select(page, "Agent 配置", unsubmitted.agentName)
  await select(page, "模型", await modelName(page, unsubmitted.agentName, unsubmitted.modelValue))
  await select(page, "思考强度", unsubmitted.thoughtLevelName)
  const run = await startRun(page)
  expect(run.target_count).toBe(settings.comparison.targets.length)
  expect(run.comparison.require_clean).toBe(settings.comparison.requireClean)
  expect(run.targets.map((t) => t.snapshot.base_model)).toEqual(settings.comparison.targets.map((t) => t.modelValue))
  await completeRun(page, run.id, settings.comparison.targets.length)
  const cardsFit = await page.locator('section [data-slot="card"]').evaluateAll((cards) => cards.every((card) => card.scrollWidth <= card.clientWidth))
  expect(cardsFit, "长模型/思考强度取值不得撑出结果卡片").toBe(true)
  await page.screenshot({ path: info.outputPath("agent-comparison.png") })
  expect(errors).toEqual([])
})

test("真实 Agent：生成中停止并保留已收到的文本", async ({ page }, info) => {
  const errors = observeErrors(page)
  await createProject(page, `E2E 停止 ${Date.now()}`, "逐行列出 1 到 500，每行包含序号和一句不少于 20 字的中文阅读建议。不要省略，不要调用工具，直接开始正文。")
  const name = await modelName(page, settings.run.agentName, settings.run.modelValue)
  await select(page, "Agent 配置", settings.run.agentName)
  await select(page, "模型", name)
  await select(page, "思考强度", settings.run.thoughtLevelName)
  await page.getByRole("button", { name: "添加到对比", exact: true }).click()
  const run = await startRun(page)
  await expect.poll(async () => {
    const current = await get<RunPacket>(page, `/runs/${run.id}`)
    expect(current.status).toBe("running")
    return current.targets[0].attempts[0].output_text.length
  }, { timeout: settings.timeoutMs, intervals: [250, 500] }).toBeGreaterThan(0)
  const cancelled = page.waitForResponse((r) => r.request().method() === "POST" && /\/attempts\/[^/]+\/cancel$/.test(new URL(r.url()).pathname))
  await page.getByRole("button", { name: "停止", exact: true }).click()
  expect((await cancelled).status()).toBe(202)
  await expect.poll(async () => (await get<RunPacket>(page, `/runs/${run.id}`)).targets[0].attempts[0].status,
    { timeout: settings.timeoutMs, intervals: [250, 500] }).toBe("cancelled")
  const final = (await get<RunPacket>(page, `/runs/${run.id}`)).targets[0].attempts[0]
  expect(final.stop_reason).toBe("cancelled")
  expect(final.output_text.length).toBeGreaterThan(0)
  expect(final.readonly_check).toBe("passed")
  await expect(page.getByRole("button", { name: "重试", exact: true })).toBeVisible()
  await expect(page.getByText("已停止", { exact: true })).toHaveCount(2)
  await page.screenshot({ path: info.outputPath("cancelled.png") })
  expect(errors).toEqual([])
})


test("对象选择提交：单表单、重复组合、编辑取消、顺序、上限与空列表", async ({ page }, info) => {
  const errors = observeErrors(page)
  await createProject(page, `E2E 选择提交 ${Date.now()} 很长的项目名称用于验证侧栏截断不会挤出操作按钮`, "仅验证选择器，不执行")
  const name = await modelName(page, settings.run.agentName, settings.run.modelValue)
  const editor = page.getByRole("region", { name: "选择对比对象", exact: true })
  const selected = page.getByRole("region", { name: /^已选对象 / })
  await expect(selected).toHaveCount(0)
  await expect(page.getByRole("button", { name: "运行", exact: true })).toBeDisabled()
  await select(page, "Agent 配置", settings.run.agentName)
  await select(page, "模型", name)
  await expect(selected).toHaveCount(0)
  await select(page, "思考强度", settings.run.thoughtLevelName)
  for (let i = 1; i <= 4; i++) {
    if (i > 1) {
      await select(page, "模型", name)
      await select(page, "思考强度", settings.run.thoughtLevelName)
    }
    await page.getByRole("button", { name: "添加到对比", exact: true }).click()
    await expect(selected).toHaveCount(i)
    const formBounds = (await editor.boundingBox())!
    const selectedBounds = (await selected.first().boundingBox())!
    expect(selectedBounds.y).toBeGreaterThanOrEqual(formBounds.y + formBounds.height)
    await expect(editor).toHaveCount(1)
    await expect(page.getByRole("combobox", { name: "模型", exact: true })).toHaveText("选择模型")
  }
  const selectedBoxes = await selected.evaluateAll((items) => items.map((item) => { const b = item.getBoundingClientRect(); return { x: b.x, y: b.y } }))
  expect(selectedBoxes[0]!.y).toBe(selectedBoxes[1]!.y)
  expect(selectedBoxes[2]!.y).toBe(selectedBoxes[3]!.y)
  expect(selectedBoxes[2]!.y).toBeGreaterThan(selectedBoxes[0]!.y)
  await expect(page.getByRole("button", { name: "添加到对比", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "运行", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "编辑对象 2", exact: true }).click()
  await select(page, "Agent 配置", settings.analysis.agentName)
  await expect(page.getByRole("combobox", { name: "模型", exact: true })).toHaveText("选择模型")
  await expect(selected.nth(1)).toContainText(settings.run.agentName)
  await expect(page.getByRole("button", { name: "保存修改", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "运行", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "取消修改", exact: true }).click()
  await expect(selected.nth(1)).toContainText(settings.run.agentName)
  await expect(page.getByRole("button", { name: "运行", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "编辑对象 2", exact: true }).click()
  await select(page, "Agent 配置", settings.analysis.agentName)
  await select(page, "模型", await modelName(page, settings.analysis.agentName, settings.analysis.modelValue))
  await select(page, "思考强度", settings.analysis.thoughtLevelName)
  await page.getByRole("button", { name: "保存修改", exact: true }).click()
  await expect(selected).toHaveCount(4)
  await expect(selected.nth(1)).toContainText(settings.analysis.agentName)
  await expect(selected.first()).toContainText(settings.run.agentName)
  await page.getByRole("button", { name: "上移对象 2", exact: true }).click()
  await expect(selected.first()).toContainText(settings.analysis.agentName)
  await page.screenshot({ path: info.outputPath("compact-selection.png"), fullPage: true })
  await page.getByRole("button", { name: "移除对象 1", exact: true }).click()
  await expect(selected.first()).toContainText(settings.run.agentName)
  for (let i = 3; i > 0; i--) await page.getByRole("button", { name: "移除对象 1", exact: true }).click()
  await expect(selected).toHaveCount(0)
  await expect(editor).toHaveCount(1)
  await expect(page.getByRole("button", { name: "运行", exact: true })).toBeDisabled()
  const sidebarFits = await page.locator("aside nav a").evaluateAll((links) => links.every((link) => {
    const aside = link.closest("aside")!.getBoundingClientRect()
    const bounds = link.getBoundingClientRect()
    return bounds.right <= aside.right && bounds.left >= aside.left
  }))
  expect(sidebarFits).toBe(true)
  await expect(page.locator("aside [aria-label$='次运行']")).toHaveCount(0)
  expect(errors).toEqual([])
})

test("真实 API：双协议、图片 PDF 文本、草稿恢复与历史继续", async ({ page }, info) => {
  const errors = observeErrors(page)
  const projectId = await createProject(page, `E2E API 附件 ${Date.now()}`, "请概括所有附件，每个附件一句话。不要调用工具。")
  // 使用实际工作台页面导出的图片、PDF，以及仓库说明文件作为输入。
  const image = info.outputPath("workspace.png")
  const pdf = info.outputPath("workspace.pdf")
  await page.screenshot({ path: image })
  await page.pdf({ path: pdf, format: "A4" })
  await page.getByLabel("添加素材附件", { exact: true }).setInputFiles([image, pdf, "../../README.md"])
  await expect(page.getByRole("button", { name: /移除附件/ })).toHaveCount(3)
  await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("button", { name: /移除附件/ })).toHaveCount(3)
  const materialWithFiles = (await page.getByLabel("素材", { exact: true }).locator("..").boundingBox())!
  const promptWithFiles = (await page.getByLabel("提示词", { exact: true }).boundingBox())!
  expect(Math.abs(materialWithFiles.height - promptWithFiles.height)).toBeLessThan(1)
  expect(materialWithFiles.y).toBe(promptWithFiles.y)
  for (const provider of settings.providerNames) {
    await select(page, "对象类型", "API Provider")
    await select(page, "API Provider", provider)
    await select(page, "模型", "Gemini 3.8 Flash High")
    await page.getByRole("button", { name: "添加到对比", exact: true }).click()
  }
  const run = await startRun(page)
  expect(run.schema_version).toBe(6)
  expect(run.input.attachments).toHaveLength(3)
  await expect.poll(async () => {
    const current = await get<RunPacket>(page, `/runs/${run.id}`)
    if (["partial", "failed"].includes(current.status)) throw new Error(JSON.stringify(current.targets.map((t) => t.attempts.at(-1)?.error)))
    return current.status
  }, { timeout: settings.timeoutMs, intervals: [1000] }).toBe("succeeded")
  await expect(page.getByRole("button", { name: "重试", exact: true })).toHaveCount(2)
  const final = await get<RunPacket>(page, `/runs/${run.id}`)
  expect(final.targets.every((t) => t.attempts.at(-1)!.output_text.length > 20)).toBe(true)
  await page.goto(`/projects/${projectId}/runs/${run.id}`)
  await expect(page.getByText("输入附件", { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath("api-attachments.png") })
  await page.getByRole("button", { name: "基于此轮继续", exact: true }).click()
  await expect(page.getByRole("region", { name: /^已选对象 / })).toHaveCount(2)
  await expect(page.getByRole("region", { name: "已选对象 1", exact: true })).toContainText(settings.providerNames[0])
  await expect(page.getByRole("region", { name: "已选对象 2", exact: true })).toContainText(settings.providerNames[1])
  await expect(page.getByRole("region", { name: "选择对比对象", exact: true })).toHaveCount(1)
  await expect(page.getByRole("button", { name: /移除附件/ })).toHaveCount(3)
  expect(errors).toEqual([])
})


test("对象独立思考强度：同模型不同档位、混合 API、重试与历史恢复", async ({ page }, info) => {
  const errors = observeErrors(page)
  const projectId = await createProject(page, `E2E 独立思考强度 ${Date.now()}`, "只回复素材中的校验词（含表情，不含句号），不要解释、Markdown 或调用工具。")
  const name = await modelName(page, settings.run.agentName, settings.run.modelValue)
  for (const level of [settings.run.thoughtLevelName, settings.run.alternateThoughtLevelName]) {
    await select(page, "Agent 配置", settings.run.agentName)
    await select(page, "模型", name)
    await expect(page.getByRole("button", { name: "添加到对比", exact: true })).toBeDisabled()
    await select(page, "思考强度", level)
    await page.getByRole("button", { name: "添加到对比", exact: true }).click()
  }
  await select(page, "对象类型", "API Provider")
  await select(page, "API Provider", settings.providerNames[0])
  await select(page, "模型", "Gemini 3.8 Flash High")
  await expect(page.getByRole("combobox", { name: "思考强度", exact: true })).toHaveText("不设置")
  await page.getByRole("button", { name: "添加到对比", exact: true }).click()
  const expectedLevels = [settings.run.thoughtLevelName, settings.run.alternateThoughtLevelName, null]
  const run = await startRun(page)
  expect(run.targets.map((t) => t.snapshot.thought_level_name)).toEqual(expectedLevels)
  expect(new Set(run.targets.slice(0, 2).map((t) => t.snapshot.thought_native_value)).size).toBe(2)
  expect(run.comparison).not.toHaveProperty("thought_level")
  await completeRun(page, run.id, 3)
  await page.getByRole("button", { name: "重试", exact: true }).first().click()
  await expect.poll(async () => {
    const current = await get<RunPacket>(page, `/runs/${run.id}`)
    expect(current.targets.map((t) => t.snapshot.thought_level_name)).toEqual(expectedLevels)
    const attempts = current.targets[0].attempts
    return attempts.length === 2 && attempts[1].status === "succeeded"
  }, { timeout: settings.timeoutMs, intervals: [500, 1000] }).toBe(true)
  await page.goto(`/projects/${projectId}/runs/${run.id}`)
  await page.getByRole("button", { name: "基于此轮继续", exact: true }).click()
  await expect(page.getByRole("region", { name: /^已选对象 / })).toHaveCount(3)
  for (const [i, level] of expectedLevels.entries()) await expect(page.getByRole("region", { name: `已选对象 ${i + 1}`, exact: true })).toContainText(`思考 ${level ?? "未设置"}`)
  await page.getByRole("button", { name: "编辑对象 2", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "思考强度", exact: true })).toHaveText(settings.run.alternateThoughtLevelName)
  await select(page, "思考强度", settings.run.thoughtLevelName)
  await page.getByRole("button", { name: "取消修改", exact: true }).click()
  await expect(page.getByRole("region", { name: "已选对象 2", exact: true })).toContainText(`思考 ${settings.run.alternateThoughtLevelName}`)
  await page.getByRole("button", { name: "编辑对象 1", exact: true }).click()
  await page.getByRole("region", { name: "选择对比对象", exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath("object-thought-levels.png") })
  expect(errors).toEqual([])
})


test("模型搜索：名称和标识过滤、键盘选择、空结果、当前选择与分析下拉框", async ({ page }, info) => {
  const errors = observeErrors(page)
  await createProject(page, `E2E 模型搜索 ${Date.now()}`, "模型搜索交互验收，不启动生成。")
  const target = settings.comparison.targets[0]!
  const name = await modelName(page, target.agentName, target.modelValue)
  const { items: agents } = await get<{ items: AgentConfigView[] }>(page, "/agent-configs")
  const agent = agents.find((a) => a.name === target.agentName)!
  const { items: models } = await get<{ items: ModelOptionView[] }>(page, `/agent-configs/${agent.id}/models`)
  await select(page, "Agent 配置", target.agentName)
  const trigger = page.getByRole("combobox", { name: "模型", exact: true })
  await trigger.focus()
  await trigger.press("ArrowDown")
  const search = page.getByRole("combobox", { name: "搜索模型", exact: true })
  await expect(search).toBeFocused()
  await expect(page.getByRole("option")).toHaveCount(models.length)
  await search.fill(target.modelValue.toUpperCase())
  await expect(page.getByRole("option")).toHaveCount(1)
  await expect(page.getByRole("option", { name, exact: true })).toBeVisible()
  await search.press("Enter")
  await expect(trigger).toHaveText(name)
  await expect(search).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await select(page, "思考强度", target.thoughtLevelName)

  await trigger.click()
  await expect(search).toHaveValue("")
  await search.fill("<>&[不存在的模型]")
  await expect(page.getByText("没有匹配的模型", { exact: true })).toBeVisible()
  await expect(page.getByRole("option")).toHaveCount(0)
  await search.press("Enter")
  await expect(search).toBeVisible()
  await search.press("Escape")
  await expect(trigger).toHaveText(name)
  await expect(page.getByRole("combobox", { name: "思考强度", exact: true })).toHaveText(target.thoughtLevelName)
  await trigger.click()
  await expect(search).toHaveValue("")
  await expect(page.getByRole("option")).toHaveCount(models.length)
  await search.fill(name.toUpperCase())
  await page.getByRole("option", { name, exact: true }).click()
  await expect(page.getByRole("combobox", { name: "思考强度", exact: true })).toHaveText(target.thoughtLevelName)
  await trigger.click()
  await search.fill("gemini")
  await page.screenshot({ path: info.outputPath("model-search.png") })
  await search.press("Escape")

  await select(page, "对象类型", "API Provider")
  await select(page, "API Provider", settings.providerNames[0])
  await trigger.click()
  await search.fill("GEMINI")
  await expect(page.getByRole("option", { name: "Gemini 3.8 Flash High", exact: true })).toBeVisible()
  await search.press("Enter")
  await expect(trigger).toHaveText("Gemini 3.8 Flash High")

  await page.getByRole("button", { name: "分析", exact: true }).click()
  await page.getByRole("button", { name: "新会话", exact: true }).click()
  await select(page, "分析用 Agent", target.agentName)
  await page.getByRole("combobox", { name: "分析模型", exact: true }).click()
  const analysisSearch = page.getByRole("combobox", { name: "搜索分析模型", exact: true })
  await expect(analysisSearch).toBeFocused()
  await analysisSearch.fill(target.modelValue.toUpperCase())
  await expect(page.getByRole("option")).toHaveCount(1)
  await analysisSearch.press("ArrowDown")
  await analysisSearch.press("Enter")
  await expect(page.getByRole("combobox", { name: "分析模型", exact: true })).toHaveText(name)
  await expect(page.getByRole("dialog", { name: "按需分析", exact: true })).toBeVisible()
  expect(errors).toEqual([])
})


test("工作区上下布局：导航保留、配置在上、结果在下、独立滚动与调整高度", async ({ page }, info) => {
  const errors = observeErrors(page)
  await createProject(page, `E2E 上下布局 ${Date.now()}`, "上下布局验收，不启动生成。")
  const config = page.getByRole("region", { name: "配置栏", exact: true })
  const results = page.getByRole("region", { name: "结果栏", exact: true })
  const separator = page.getByRole("separator", { name: "调整配置栏与结果栏高度", exact: true })
  async function bounds() {
    const top = await config.boundingBox()
    const bottom = await results.boundingBox()
    const nav = await page.locator("aside").boundingBox()
    expect(top).not.toBeNull()
    expect(bottom).not.toBeNull()
    expect(nav).not.toBeNull()
    expect(top!.y + top!.height).toBeLessThanOrEqual(bottom!.y)
    expect(top!.x).toBe(bottom!.x)
    expect(top!.width).toBe(bottom!.width)
    expect(top!.x).toBeGreaterThanOrEqual(nav!.x + nav!.width)
    expect(nav!.height).toBe(page.viewportSize()!.height)
    expect(bottom!.y + bottom!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
    return { top: top!, bottom: bottom! }
  }
  const before = await bounds()
  await expect(separator).toHaveAttribute("aria-orientation", "horizontal")
  const handle = (await separator.boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 100, { steps: 10 })
  await page.mouse.up()
  const dragged = await bounds()
  expect(dragged.top.height).toBeGreaterThan(before.top.height + 50)
  expect(dragged.bottom.height).toBeLessThan(before.bottom.height - 50)
  await separator.focus()
  await separator.press("ArrowUp")
  expect((await bounds()).top.height).toBeLessThan(dragged.top.height)
  const scroll = config.locator("div.overflow-y-auto").first()
  await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight })
  const scrolled = await bounds()
  expect(scrolled.top.y).toBe(before.top.y)
  expect(await results.evaluate((el) => el.scrollTop)).toBe(0)
  await scroll.evaluate((el) => { el.scrollTop = 0 })
  await page.screenshot({ path: info.outputPath("vertical-workspace.png") })
  await page.setViewportSize({ width: 900, height: 700 })
  await bounds()
  expect(await page.locator("html").evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
  await expect(page.getByRole("heading", { name: /^E2E 上下布局/ })).toBeVisible()
  expect(errors).toEqual([])
})


test("对象选择紧凑布局：等宽输入、四项同排、环境选项和窄屏", async ({ page }, info) => {
  const errors = observeErrors(page)
  await createProject(page, `E2E 紧凑对象选择 ${Date.now()}`, "紧凑选择布局验收，不启动生成。")
  const form = page.getByRole("region", { name: "选择对比对象", exact: true })
  const choices = form.getByRole("group", { name: "对象选择项", exact: true })
  const controls = choices.getByRole("combobox")
  async function boxes() {
    await expect(controls).toHaveCount(4)
    const bounds = await controls.evaluateAll((nodes) => nodes.map((el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, right: b.right } }))
    const parent = (await choices.boundingBox())!
    for (const b of bounds) {
      expect(b.x).toBeGreaterThanOrEqual(parent.x)
      expect(b.right).toBeLessThanOrEqual(parent.x + parent.width + 1)
    }
    return bounds
  }
  const initial = await boxes()
  expect(Math.max(...initial.map((b) => b.y)) - Math.min(...initial.map((b) => b.y))).toBeLessThan(1)
  await expect(form.getByText("选择对象", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("combobox", { name: "Agent 配置", exact: true })).toHaveText("Agent 配置")
  await expect(page.getByRole("combobox", { name: "思考强度", exact: true })).toHaveText("思考强度")
  const material = (await page.getByLabel("素材", { exact: true }).locator("..").boundingBox())!
  const prompt = (await page.getByLabel("提示词", { exact: true }).boundingBox())!
  expect(Math.abs(prompt.width - material.width)).toBeLessThan(1)
  expect((await choices.boundingBox())!.width).toBeGreaterThan(material.width * 1.8)
  expect(prompt.y).toBe(material.y)
  expect(Math.abs(prompt.height - material.height)).toBeLessThan(1)
  const materialInput = page.getByLabel("素材", { exact: true })
  const original = await materialInput.inputValue()
  const initialHeight = (await materialInput.boundingBox())!.height
  await materialInput.fill(`${original}\n`.repeat(50))
  expect((await materialInput.boundingBox())!.height).toBe(initialHeight)
  await materialInput.fill(original)
  await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible()
  const config = (await page.getByRole("region", { name: "配置栏", exact: true }).boundingBox())!
  expect(config.height).toBeLessThan(page.viewportSize()!.height * 0.4)
  await expect(page.getByRole("combobox", { name: "模型", exact: true })).toBeDisabled()
  const target = settings.comparison.targets[1]!
  const name = await modelName(page, target.agentName, target.modelValue)
  await select(page, "Agent 配置", target.agentName)
  await select(page, "模型", name)
  await select(page, "思考强度", target.thoughtLevelName)
  const selected = await boxes()
  expect(Math.max(...selected.map((b) => b.y)) - Math.min(...selected.map((b) => b.y))).toBeLessThan(1)
  const add = (await form.getByRole("button", { name: "添加到对比", exact: true }).boundingBox())!
  expect(add.y).toBe(selected[3]!.y)
  expect(add.x).toBeGreaterThan(selected[3]!.right)
  await expect(page.getByRole("combobox", { name: "Agent 配置", exact: true })).toHaveAttribute("title", /干净|全局环境/)
  await expect(page.getByRole("switch", { name: "要求干净环境", exact: true })).toHaveCount(0)
  await expect(form.getByRole("button", { name: "添加到对比", exact: true })).toBeEnabled()
  await form.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath("compact-object-fields.png") })
  for (const input of [page.getByLabel("提示词", { exact: true }), materialInput.locator("..")]) {
    const before = (await input.boundingBox())!
    await page.mouse.move(before.x + before.width - 3, before.y + before.height - 3)
    await page.mouse.down()
    await page.mouse.move(before.x + before.width - 3, before.y + before.height + 45, { steps: 6 })
    await page.mouse.up()
    const resizedMaterial = (await materialInput.locator("..").boundingBox())!
    const resizedPrompt = (await page.getByLabel("提示词", { exact: true }).boundingBox())!
    expect((await input.boundingBox())!.height).toBeGreaterThan(before.height + 20)
    expect(Math.abs(resizedMaterial.height - resizedPrompt.height)).toBeLessThan(1)
  }
  await page.getByRole("combobox", { name: "模型", exact: true }).click()
  const search = page.getByRole("combobox", { name: "搜索模型", exact: true })
  const popup = (await search.locator("../..").boundingBox())!
  expect(popup.width).toBeGreaterThanOrEqual(selected[2]!.width)
  await search.fill(target.modelValue.toUpperCase())
  await page.getByRole("option", { name, exact: true }).click()
  await expect(form.getByRole("button", { name: "添加到对比", exact: true })).toBeEnabled()
  await page.setViewportSize({ width: 2048, height: 1000 })
  const wide = await boxes()
  expect(Math.max(...wide.map((b) => b.y)) - Math.min(...wide.map((b) => b.y))).toBeLessThan(1)
  const wideMaterial = (await page.getByLabel("素材", { exact: true }).locator("..").boundingBox())!
  const widePrompt = (await page.getByLabel("提示词", { exact: true }).boundingBox())!
  expect(Math.abs(wideMaterial.width - widePrompt.width)).toBeLessThan(1)
  expect(Math.abs(wideMaterial.height - widePrompt.height)).toBeLessThan(1)
  await page.screenshot({ path: info.outputPath("wide-object-fields.png") })
  await page.setViewportSize({ width: 650, height: 800 })
  await form.scrollIntoViewIfNeeded()
  const narrow = await boxes()
  expect(narrow[0]!.y).toBe(narrow[1]!.y)
  expect(narrow[2]!.y).toBe(narrow[3]!.y)
  expect(narrow[2]!.y).toBeGreaterThan(narrow[0]!.y)
  expect(await page.locator("html").evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(650)
  await select(page, "对象类型", "API Provider")
  await select(page, "API Provider", settings.providerNames[0])
  await select(page, "模型", "Gemini 3.8 Flash High")
  await expect(form.getByRole("button", { name: "添加到对比", exact: true })).toBeEnabled()
  expect(errors).toEqual([])
})


test("真实 Agent：四个全局配置可选、模型与思考强度可读、同轮运行", async ({ page }, info) => {
  const errors = observeErrors(page)
  await createProject(page, `E2E 全局环境 ${Date.now()}`, "只回复素材中的校验词（含表情，不含句号），不要解释、Markdown 或调用工具。")
  const targets = [
    { ...settings.comparison.targets[0], agentName: "Pi 全局" },
    { ...settings.run, agentName: "Codex 全局" },
    { ...settings.analysis, agentName: "DeepSeek Harness 全局" },
    settings.comparison.targets[1],
  ]
  const { items: agents } = await get<{ items: AgentConfigView[] }>(page, "/agent-configs")
  for (const target of targets) {
    const matches = agents.filter((a) => a.name === target.agentName)
    expect(matches).toHaveLength(1)
    const agent = matches[0]!
    expect(agent.home_mode).toBe("overlay")
    expect(agent.available, agent.unavailable_reasons.join("；")).toBe(true)
    expect(agent.purity?.passed).toBe(true)
    await select(page, "Agent 配置", target.agentName)
    await expect(page.getByRole("combobox", { name: "Agent 配置", exact: true })).toHaveAttribute("title", /全局环境/)
    await select(page, "模型", await modelName(page, target.agentName, target.modelValue))
    await select(page, "思考强度", target.thoughtLevelName)
    await page.getByRole("button", { name: "添加到对比", exact: true }).click()
  }
  const run = await startRun(page)
  expect(run.comparison.require_clean).toBe(false)
  expect(run.targets).toHaveLength(4)
  expect(run.targets.every((t) => t.snapshot.kind !== "provider" && t.snapshot.config.home_mode === "overlay")).toBe(true)
  const final = await completeRun(page, run.id, 4)
  const pi = final.targets.find((t) => t.snapshot.kind !== "provider" && t.snapshot.agent_config_name === "Pi 全局")!
  expect(pi.attempts.at(-1)!.output_text.trim()).toBe("验收通过😀")
  await page.screenshot({ path: info.outputPath("global-agent-comparison.png") })
  await page.goto("/settings/agents")
  await expect(page.getByRole("button", { name: "导入本机配置为草稿", exact: true })).toBeVisible()
  for (const target of targets) await expect(page.getByRole("link").filter({ hasText: target.agentName })).toHaveCount(1)
  expect(errors).toEqual([])
})


test("内容库：附件保存、两类选择创建、真实运行快照、编辑删除与草稿复用", async ({ page }, info) => {
  const errors = observeErrors(page)
  const stamp = Date.now()
  const materialTitle = `E2E 素材库 ${stamp}`
  const promptTitle = `E2E 提示词库 ${stamp}`
  const content = "校验词：验收通过😀。特殊字符：<&>、中文与换行。\n所有对象接收相同素材。"
  const instruction = "只回复素材中的校验词（含表情，不含句号），不要解释、Markdown 或调用工具。"
  const card = (title: string) => page.getByRole("region", { name: `内容库条目 ${title}`, exact: true })
  async function saveEditor(label: string) {
    const dialog = page.getByRole("dialog", { name: label, exact: true })
    const saved = page.waitForResponse((r) => ["POST", "PUT"].includes(r.request().method()) && /\/library-items(?:\/[^/]+)?$/.test(new URL(r.url()).pathname))
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    const response = await saved
    expect(response.ok(), await response.text()).toBe(true)
    await expect(dialog).toHaveCount(0)
    return response.json() as Promise<LibraryItemView>
  }
  async function pick(kind: "素材" | "提示词", title: string, replace = false) {
    await page.getByRole("button", { name: replace ? `从库中选择${kind}` : `选择已保存${kind}`, exact: true }).click()
    const dialog = page.getByRole("dialog", { name: `选择已保存${kind}`, exact: true })
    await dialog.getByRole("textbox", { name: `搜索已保存${kind}`, exact: true }).fill(title)
    await dialog.getByRole("button", { name: "刷新列表", exact: true }).click()
    await expect(dialog.locator("button[aria-pressed]")).toHaveCount(1)
    await dialog.getByRole("button", { name: title, exact: true }).click()
    await dialog.getByRole("button", { name: replace ? "载入并替换" : "选择此内容", exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
  async function createFromDialog(title: string) {
    const dialog = page.getByRole("dialog", { name: "新建项目", exact: true })
    await dialog.getByLabel("项目名称", { exact: true }).fill(title)
    const created = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/projects"))
    await dialog.getByRole("button", { name: "创建", exact: true }).click()
    const response = await created
    expect(response.status(), await response.text()).toBe(201)
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible()
    return response.json() as Promise<ProjectView>
  }
  await page.goto("/library")
  await expect(page.getByRole("heading", { name: "内容库", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "新建素材", exact: true }).click()
  let editor = page.getByRole("dialog", { name: "保存素材", exact: true })
  await expect(editor.getByRole("button", { name: "保存", exact: true })).toBeDisabled()
  await editor.getByLabel("名称", { exact: true }).fill(materialTitle)
  await editor.getByLabel("素材正文", { exact: true }).fill(content)
  const image = info.outputPath("library.png"), pdf = info.outputPath("library.pdf")
  await page.screenshot({ path: image }); await page.pdf({ path: pdf, format: "A4" })
  await editor.getByLabel("内容库素材附件", { exact: true }).setInputFiles([image, pdf, "../../README.md"])
  await page.screenshot({ path: info.outputPath("library-editor.png") })
  const material = await saveEditor("保存素材")
  expect(material.attachments.map((f) => f.kind)).toEqual(["image", "pdf", "text"])
  await expect(card(materialTitle)).toBeVisible()
  await card(materialTitle).getByRole("button", { name: `查看详情 ${materialTitle}`, exact: true }).click()
  const materialDetails = page.getByRole("dialog", { name: materialTitle, exact: true })
  await expect(materialDetails.getByText(content, { exact: true })).toBeVisible()
  await expect(materialDetails.getByRole("link")).toHaveCount(3)
  await expect(materialDetails.getByRole("img", { name: "library.png", exact: true })).toBeVisible()
  for (const file of material.attachments) {
    await expect(materialDetails.getByRole("link", { name: file.name, exact: true })).toHaveAttribute("href", `/api/v1/library-attachments/${file.id}/content`)
  }
  await page.keyboard.press("Escape")
  await expect(materialDetails).toHaveCount(0)
  await page.getByRole("tab", { name: "提示词", exact: true }).click()
  await page.getByRole("button", { name: "新建提示词", exact: true }).click()
  editor = page.getByRole("dialog", { name: "保存提示词", exact: true })
  await editor.getByLabel("名称", { exact: true }).fill(promptTitle)
  await editor.getByLabel("提示词正文", { exact: true }).fill(instruction)
  const prompt = await saveEditor("保存提示词")
  await card(promptTitle).getByRole("button", { name: "使用", exact: true }).click()
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(promptTitle)
  await pick("素材", materialTitle)
  const project = await createFromDialog(`E2E 库创建项目 ${stamp}`)
  expect(project.draft_sources).toEqual({ material: { id: material.id, version: 1, title: materialTitle }, prompt: { id: prompt.id, version: 1, title: promptTitle } })
  expect(project.draft_attachments).toHaveLength(3)
  expect(project.draft_attachments.map((f) => f.sha256)).toEqual(material.attachments.map((f) => f.sha256))
  expect(project.draft_attachments.every((f) => !material.attachments.some((m) => m.id === f.id))).toBe(true)
  await expect(page.getByLabel("素材", { exact: true })).toHaveValue(content)
  await expect(page.getByLabel("提示词", { exact: true })).toHaveValue(instruction)
  await select(page, "对象类型", "API Provider")
  await select(page, "API Provider", settings.providerNames[0])
  await select(page, "模型", "Gemini 3.8 Flash High")
  await page.getByRole("button", { name: "添加到对比", exact: true }).click()
  const run = await startRun(page)
  expect(run.input.library_sources).toEqual(project.draft_sources)
  await completeRun(page, run.id, 1)

  await page.getByRole("link", { name: "内容库", exact: true }).click()
  await page.getByRole("textbox", { name: "搜索内容库", exact: true }).fill(materialTitle)
  await card(materialTitle).getByRole("button", { name: "编辑", exact: true }).click()
  editor = page.getByRole("dialog", { name: "编辑素材", exact: true })
  await editor.getByLabel("素材正文", { exact: true }).fill("二版素材，保留两个附件。")
  await editor.getByRole("button", { name: "移除附件 README.md", exact: true }).click()
  const version2 = await saveEditor("编辑素材")
  expect(version2.version).toBe(2)
  expect(version2.attachments).toHaveLength(2)
  await page.getByRole("tab", { name: "提示词", exact: true }).click()
  await page.getByRole("textbox", { name: "搜索内容库", exact: true }).fill(promptTitle)
  await card(promptTitle).getByRole("button", { name: "删除", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "移入回收站", exact: true }).click()
  await expect(card(promptTitle)).toHaveCount(0)
  await page.goto(`/projects/${project.id}`)
  await expect(page.getByLabel("素材", { exact: true })).toHaveValue(content)
  await expect(page.getByLabel("提示词", { exact: true })).toHaveValue(instruction)
  const historical = await get<RunPacket>(page, `/runs/${run.id}`)
  expect(historical.input.material).toBe(content)
  expect(historical.input.attachments).toHaveLength(3)
  expect(historical.input.library_sources).toEqual(project.draft_sources)

  const unsaved = "直接保存输入框最新内容，<&> 😀"
  await page.getByLabel("提示词", { exact: true }).fill(unsaved)
  await page.getByRole("button", { name: "保存提示词到库", exact: true }).click()
  editor = page.getByRole("dialog", { name: "保存提示词", exact: true })
  await expect(editor.getByLabel("提示词正文", { exact: true })).toHaveValue(unsaved)
  await editor.getByLabel("名称", { exact: true }).fill(`E2E 即时提示词 ${stamp}`)
  expect((await saveEditor("保存提示词")).content).toBe(unsaved)
  await pick("素材", materialTitle, true)
  await expect(page.getByLabel("素材", { exact: true })).toHaveValue(version2.content)
  await expect(page.getByLabel("提示词", { exact: true })).toHaveValue(unsaved)
  await expect(page.getByRole("button", { name: /移除附件/ })).toHaveCount(2)
  await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel("素材", { exact: true })).toHaveValue(version2.content)
  await expect(page.getByLabel("提示词", { exact: true })).toHaveValue(unsaved)
  await page.getByRole("button", { name: "保存素材到库", exact: true }).click()
  editor = page.getByRole("dialog", { name: "保存素材", exact: true })
  const copyTitle = `E2E 草稿素材副本 ${stamp}`
  await editor.getByLabel("名称", { exact: true }).fill(copyTitle)
  const copied = await saveEditor("保存素材")
  expect(copied.attachments).toHaveLength(2)
  await page.goto("/library?kind=prompt")
  await page.getByRole("checkbox", { name: "显示内容库回收站", exact: true }).check()
  await page.getByRole("textbox", { name: "搜索内容库", exact: true }).fill(promptTitle)
  await card(promptTitle).getByRole("button", { name: "恢复", exact: true }).click()
  await expect(card(promptTitle).getByRole("button", { name: "使用", exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "素材", exact: true }).click()
  await page.getByRole("textbox", { name: "搜索内容库", exact: true }).fill(copyTitle)
  await card(copyTitle).getByRole("button", { name: "使用", exact: true }).click()
  await pick("提示词", promptTitle)
  const second = await createFromDialog(`E2E 使用素材 ${stamp}`)
  expect(second.draft_material).toBe(version2.content)
  expect(second.draft_prompt).toBe(instruction)
  expect(second.draft_sources?.material?.id).toBe(copied.id)
  await page.screenshot({ path: info.outputPath("library-workspace.png") })
  await page.goto("/library")
  await page.getByRole("textbox", { name: "搜索内容库", exact: true }).fill(`E2E`)
  await page.screenshot({ path: info.outputPath("library-page.png") })
  await page.setViewportSize({ width: 650, height: 800 })
  expect(await page.locator("html").evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(650)
  await card(copyTitle).getByRole("button", { name: "使用", exact: true }).click()
  await page.getByRole("button", { name: "选择已保存提示词", exact: true }).click()
  const narrowPicker = page.getByRole("dialog", { name: "选择已保存提示词", exact: true })
  await narrowPicker.getByRole("textbox", { name: "搜索已保存提示词", exact: true }).fill(promptTitle)
  await expect(narrowPicker.locator("button[aria-pressed]")).toHaveCount(1)
  await narrowPicker.getByRole("button", { name: promptTitle, exact: true }).click()
  await page.screenshot({ path: info.outputPath("library-picker-narrow.png") })
  expect(await page.locator("html").evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(650)
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  expect(errors).toEqual([])
})

test("内容库：五列卡片截断、键盘查看完整详情与弹窗编辑", async ({ page }, info) => {
  const errors = observeErrors(page)
  const prefix = `E2E 五列内容库 ${Date.now()}`
  const titles = Array.from({ length: 6 }, (_, i) => `${prefix} ${i + 1} 很长的名称用于验证卡片截断后仍可查看完整详情`)
  const content = `${"长正文 <&> 😀 连续字符abcdefghijklmnopqrstuvwxyz".repeat(15)}\n${Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 行完整内容`).join("\n")}\n正文末尾验证`
  const cards = page.getByRole("region", { name: /^内容库条目/ })
  const ids: string[] = []
  await page.goto("/library?kind=prompt")
  try {
    for (const title of titles) {
      await page.getByRole("button", { name: "新建提示词", exact: true }).click()
      const editor = page.getByRole("dialog", { name: "保存提示词", exact: true })
      await editor.getByLabel("名称", { exact: true }).fill(title)
      await editor.getByLabel("提示词正文", { exact: true }).fill(content)
      const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/library-items"))
      await editor.getByRole("button", { name: "保存", exact: true }).click()
      const response = await saved
      expect(response.ok(), await response.text()).toBe(true)
      ids.push((await response.json() as LibraryItemView).id)
      await expect(editor).toHaveCount(0)
    }
    await page.getByRole("textbox", { name: "搜索内容库", exact: true }).fill(prefix)
    await expect(cards).toHaveCount(6)
    for (const width of [1440, 2048]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(async () => cards.evaluateAll((els) => {
        const rects = els.map((el) => el.getBoundingClientRect())
        return rects.slice(0, 5).every((r) => r.top === rects[0].top) && rects[5].top > rects[0].top
      })).toBe(true)
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    const detailButton = cards.first().getByRole("button", { name: /^查看详情/ })
    expect(await detailButton.locator("h2").evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    expect(await detailButton.locator("p").first().evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    await page.screenshot({ path: info.outputPath("library-five-columns.png") })
    const title = await cards.first().getByRole("heading").innerText()
    await detailButton.focus()
    await page.keyboard.press("Enter")
    const details = page.getByRole("dialog", { name: title, exact: true })
    await expect(details).toBeVisible()
    await expect(details.getByText(content, { exact: true })).toBeAttached()
    await details.getByText(content, { exact: true }).evaluate((el) => el.parentElement!.scrollTop = el.parentElement!.scrollHeight)
    await page.screenshot({ path: info.outputPath("library-full-details.png") })
    await details.getByRole("button", { name: "编辑", exact: true }).click()
    await expect(details).toHaveCount(0)
    const editor = page.getByRole("dialog", { name: "编辑提示词", exact: true })
    await expect(editor.getByLabel("提示词正文", { exact: true })).toHaveValue(content)
    const updated = "从详情进入编辑后保存的新内容 <&> 😀"
    await editor.getByLabel("提示词正文", { exact: true }).fill(updated)
    await editor.getByRole("button", { name: "保存", exact: true }).click()
    await expect(editor).toHaveCount(0)
    const editedCard = page.getByRole("region", { name: `内容库条目 ${title}`, exact: true })
    await expect(editedCard).toContainText(updated)
    await editedCard.getByRole("button", { name: /^查看详情/ }).click()
    await expect(details.getByText(updated, { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 650, height: 800 })
    const rect = await details.boundingBox()
    expect(rect!.x).toBeGreaterThanOrEqual(15)
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(635)
    expect(await page.locator("html").evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(650)
    await page.keyboard.press("Escape")
    await expect(details).toHaveCount(0)
    await page.screenshot({ path: info.outputPath("library-cards-narrow.png") })
    expect(await page.locator("html").evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(650)
    await editedCard.getByRole("button", { name: "使用", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "新建项目", exact: true })).toBeVisible()
    await expect(page.getByRole("dialog", { name: title, exact: true })).toHaveCount(0)
    await page.keyboard.press("Escape")
    expect(errors).toEqual([])
  } finally {
    for (const id of ids) {
      const response = await page.request.delete(`/api/v1/library-items/${id}`, { headers: { "x-llm-compare": "1" } })
      expect(response.ok(), await response.text()).toBe(true)
    }
  }
})
