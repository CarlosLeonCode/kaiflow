import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { CategoryDto, RuleDto, RuleInputDto } from "@/shared/ipc";
import { mockBackend, renderWithProviders, report } from "@/test/ipc";

import { CategoriesContainer } from "./CategoriesContainer";

const SYSTEM: CategoryDto = { id: 1, name: "Sin categoría", color: "#6b7280", sort_order: 0 };
const WORK: CategoryDto = { id: 2, name: "Work", color: "#3b82f6", sort_order: 1 };

const SLACK = { app_id: "com.tinyspeck.slackmacgap", app_name: "Slack", total_ms: 600_000 };
const XCODE = { app_id: "com.apple.dt.Xcode", app_name: "Xcode", total_ms: 900_000 };

/** In-memory backend: categories and rules behave like the real commands for these flows. */
function backend(initial: { categories?: CategoryDto[]; rules?: RuleDto[] } = {}) {
  let categories = initial.categories ?? [SYSTEM, WORK];
  let rules = initial.rules ?? [];
  let nextRuleId = 100;
  const mock = mockBackend({
    categories_list: () => categories,
    rules_list: () => rules,
    get_report: () => report({ by_app: [XCODE, SLACK, { app_id: null, app_name: "Asignado manualmente", total_ms: 5 }] }),
    categories_create: (args) => {
      const created = { id: 10 + categories.length, name: args.name as string, color: args.color as string, sort_order: categories.length };
      categories = [...categories, created];
      return created;
    },
    categories_update: (args) => {
      const next = args.category as CategoryDto;
      categories = categories.map((c) => (c.id === next.id ? next : c));
      return null;
    },
    categories_delete: (args) => {
      categories = categories.filter((c) => c.id !== args.id);
      rules = rules.filter((r) => r.category_id !== args.id);
      return null;
    },
    rules_upsert: (args) => {
      const input = args.rule as RuleInputDto;
      if (input.spec.kind === "title_pattern" && input.spec.pattern.includes("(")) {
        throw { kind: "invalid_pattern", pattern: input.spec.pattern, reason: "unclosed group" };
      }
      const id = input.id > 0 ? input.id : nextRuleId++;
      rules = [...rules.filter((r) => r.id !== id), { ...input, id }];
      return id;
    },
    rules_delete: (args) => {
      rules = rules.filter((r) => r.id !== args.id);
      return null;
    },
  });
  return mock;
}

function upserts(calls: { cmd: string; args: Record<string, unknown> }[]) {
  return calls.filter((c) => c.cmd === "rules_upsert").map((c) => c.args.rule as RuleInputDto);
}

describe("CategoriesContainer", () => {
  it("lists categories, maps the system one to Uncategorized and protects it", async () => {
    backend({ rules: [{ id: 1, category_id: 2, priority: 1, spec: { kind: "app", app_id: SLACK.app_id } }] });
    renderWithProviders(<CategoriesContainer />);

    const list = await screen.findByRole("list", { name: "Category list" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Uncategorized")).toBeInTheDocument();
    expect(within(items[0]!).queryByRole("button")).not.toBeInTheDocument();
    expect(within(items[1]!).getByText("1 rule")).toBeInTheDocument();
    expect(within(items[1]!).getByRole("button", { name: "Delete Work" })).toBeInTheDocument();
  });

  it("creates a category with the chosen preset color", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<CategoriesContainer />);

    await user.click(await screen.findByRole("button", { name: "New category" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "  Reading ");
    await user.click(screen.getByRole("radio", { name: "Green" }));
    await user.click(screen.getByRole("button", { name: "Add category" }));

    await waitFor(() =>
      expect(calls.find((c) => c.cmd === "categories_create")?.args).toEqual({ name: "Reading", color: "#22c55e" }),
    );
    expect(await within(screen.getByRole("list", { name: "Category list" })).findByText("Reading")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "New category" })).not.toBeInTheDocument();
  });

  it("rejects an empty or duplicate name inline without calling the backend", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<CategoriesContainer />);

    await user.click(await screen.findByRole("button", { name: "New category" }));
    await user.click(screen.getByRole("button", { name: "Add category" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Give the category a name.");

    await user.type(screen.getByRole("textbox", { name: "Name" }), "work");
    expect(screen.getByRole("alert")).toHaveTextContent("already exists");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute("aria-invalid", "true");
    expect(calls.some((c) => c.cmd === "categories_create")).toBe(false);
  });

  it("renames and recolors a category, and Escape cancels the form", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<CategoriesContainer />);

    await user.click(await screen.findByRole("button", { name: "Edit Work" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("Work");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit Work" }));
    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Deep work");
    await user.click(screen.getByRole("radio", { name: "Violet" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(calls.find((c) => c.cmd === "categories_update")?.args.category).toEqual({
        id: 2,
        name: "Deep work",
        color: "#8b5cf6",
        sort_order: 1,
      }),
    );
    expect(await within(screen.getByRole("list", { name: "Category list" })).findByText("Deep work")).toBeInTheDocument();
  });

  it("asks before deleting and explains that time moves to Uncategorized", async () => {
    const user = userEvent.setup();
    const { calls } = backend({
      rules: [{ id: 1, category_id: 2, priority: 1, spec: { kind: "app", app_id: SLACK.app_id } }],
    });
    renderWithProviders(<CategoriesContainer />);

    await user.click(await screen.findByRole("button", { name: "Delete Work" }));
    const dialog = await screen.findByRole("alertdialog", { name: 'Delete "Work"?' });
    expect(dialog).toHaveTextContent("moves to Uncategorized");
    expect(dialog).toHaveTextContent("Its 1 rule is deleted too");
    expect(dialog).toHaveTextContent("cannot be undone");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "categories_delete")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Delete Work" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete category" }));

    await waitFor(() => expect(calls.find((c) => c.cmd === "categories_delete")?.args).toEqual({ id: 2 }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Edit Work" })).not.toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open with the error when the delete fails", async () => {
    const user = userEvent.setup();
    mockBackend({
      categories_list: () => [SYSTEM, WORK],
      rules_list: () => [],
      get_report: () => report(),
      categories_delete: () => {
        throw { kind: "storage", message: "database is locked" };
      },
    });
    renderWithProviders(<CategoriesContainer />);

    await user.click(await screen.findByRole("button", { name: "Delete Work" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete category" }));

    expect(await within(screen.getByRole("alertdialog")).findByRole("alert")).toHaveTextContent("database is locked");
  });

  it("adds an app rule from the recently seen apps on top of its group", async () => {
    const user = userEvent.setup();
    const { calls } = backend({
      rules: [{ id: 1, category_id: 2, priority: 4, spec: { kind: "app", app_id: XCODE.app_id } }],
    });
    renderWithProviders(<CategoriesContainer />);

    const form = await screen.findByRole("form", { name: "Add rule" });
    const app = within(form).getByRole("combobox", { name: "App" });
    // Seen apps are offered by name; manually assigned time is not an app.
    await waitFor(() => expect(within(app).getAllByRole("option").length).toBeGreaterThan(1));
    expect(within(app).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Choose an app…",
      "Slack (com.tinyspeck.slackmacgap)",
      "Xcode (com.apple.dt.Xcode)",
    ]);
    await user.selectOptions(app, "Slack (com.tinyspeck.slackmacgap)");
    await user.selectOptions(within(form).getByRole("combobox", { name: "Category" }), "Work");
    await user.click(within(form).getByRole("button", { name: "Add rule" }));

    await waitFor(() => expect(upserts(calls)).toHaveLength(1));
    expect(upserts(calls)[0]).toEqual({
      id: 0,
      category_id: 2,
      spec: { kind: "app", app_id: SLACK.app_id },
      priority: 5,
    });
    const rules = await screen.findByRole("list", { name: "Apps rules" });
    expect(within(rules).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Slack"),
      expect.stringContaining("Xcode"),
    ]);
  });

  it("requires the app and the category before saving", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<CategoriesContainer />);

    const form = await screen.findByRole("form", { name: "Add rule" });
    await user.click(within(form).getByRole("button", { name: "Add rule" }));

    expect(within(form).getByRole("alert")).toHaveTextContent("Choose an app and a category.");
    expect(calls.some((c) => c.cmd === "rules_upsert")).toBe(false);
  });

  it("adds a title rule restricted to an app and shows the backend's regex error inline (R9.4)", async () => {
    const user = userEvent.setup();
    const { calls } = backend();
    renderWithProviders(<CategoriesContainer />);

    const form = await screen.findByRole("form", { name: "Add rule" });
    await user.click(within(form).getByRole("radio", { name: "Window title" }));
    const pattern = within(form).getByRole("textbox", { name: "Title pattern" });
    await user.type(pattern, "Figma(");
    await user.selectOptions(within(form).getByRole("combobox", { name: "Category" }), "Work");
    await user.click(within(form).getByRole("button", { name: "Add rule" }));

    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent("unclosed group");
    expect(pattern).toHaveAttribute("aria-invalid", "true");
    expect(pattern.getAttribute("aria-describedby")).toBe(alert.id);
    // Nothing was stored: the rule list stays empty.
    expect(screen.getByText(/No rules yet/)).toBeInTheDocument();

    // Fixing the pattern clears the error and saves.
    await user.clear(pattern);
    await user.type(pattern, "Figma|Sketch");
    expect(within(form).queryByRole("alert")).not.toBeInTheDocument();
    await user.selectOptions(within(form).getByRole("combobox", { name: "Only in" }), "Xcode (com.apple.dt.Xcode)");
    await user.click(within(form).getByRole("button", { name: "Add rule" }));

    await waitFor(() => expect(upserts(calls).at(-1)).toMatchObject({
      spec: { kind: "title_pattern", pattern: "Figma|Sketch", app_id: XCODE.app_id },
      priority: 1,
    }));
    expect(await screen.findByRole("list", { name: "Window titles rules" })).toHaveTextContent("/Figma|Sketch/ in Xcode");
  });

  it("reorders rules within a group by renumbering priorities", async () => {
    const user = userEvent.setup();
    const { calls } = backend({
      rules: [
        { id: 1, category_id: 2, priority: 2, spec: { kind: "app", app_id: XCODE.app_id } },
        { id: 2, category_id: 2, priority: 1, spec: { kind: "app", app_id: SLACK.app_id } },
      ],
    });
    renderWithProviders(<CategoriesContainer />);

    expect(await screen.findByRole("button", { name: "Move Xcode up" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move Slack up" }));

    await waitFor(() => expect(upserts(calls)).toHaveLength(2));
    expect(upserts(calls).map((r) => [r.id, r.priority]).sort()).toEqual([
      [1, 1],
      [2, 2],
    ]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Move Slack up" })).toBeDisabled());
  });

  it("changes a rule's category and deletes a rule", async () => {
    const user = userEvent.setup();
    const { calls } = backend({
      rules: [{ id: 1, category_id: 2, priority: 1, spec: { kind: "app", app_id: SLACK.app_id } }],
    });
    renderWithProviders(<CategoriesContainer />);

    await user.selectOptions(await screen.findByRole("combobox", { name: "Category for Slack" }), "Uncategorized");
    await waitFor(() => expect(upserts(calls).at(-1)).toMatchObject({ id: 1, category_id: 1, priority: 1 }));

    await user.click(screen.getByRole("button", { name: "Delete rule Slack" }));
    await waitFor(() => expect(calls.find((c) => c.cmd === "rules_delete")?.args).toEqual({ id: 1 }));
    expect(await screen.findByText(/No rules yet/)).toBeInTheDocument();
  });

  it("shows list action failures in a dismissable banner", async () => {
    const user = userEvent.setup();
    mockBackend({
      categories_list: () => [SYSTEM, WORK],
      rules_list: () => [{ id: 1, category_id: 2, priority: 1, spec: { kind: "app", app_id: SLACK.app_id } }],
      get_report: () => report({ by_app: [SLACK] }),
      rules_delete: () => {
        throw { kind: "not_found" };
      },
    });
    renderWithProviders(<CategoriesContainer />);

    await user.click(await screen.findByRole("button", { name: "Delete rule Slack" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer exists");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
