import { describe, expect, it, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateTaskForm } from "../components/CreateTaskForm";
import { TaskBoard } from "../components/TaskBoard";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { createTaskService } from "../services/taskService";

describe("TaskBoard end-to-end", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("human-created task appears in the board and timeline", async () => {
    const service = createTaskService();
    const user = userEvent.setup();
    render(
      <div>
        <CreateTaskForm service={service} />
        <TaskBoard service={service} />
        <ActivityTimeline service={service} />
      </div>,
    );

    const input = screen.getByPlaceholderText(/draft webmcp outline/i);
    await user.type(input, "Wire up list_tasks");
    await user.click(screen.getByRole("button", { name: /add task/i }));

    expect(screen.getAllByText("Wire up list_tasks").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Human").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("complementary", { name: /activity timeline/i }),
    ).toBeInTheDocument();
  });

  it("service-driven updates (simulating an agent) render without explicit refresh", async () => {
    const service = createTaskService();
    render(<TaskBoard service={service} />);

    // Each column renders an empty-state row.
    expect(screen.getAllByText(/no tasks/i)).toHaveLength(3);
    act(() => {
      service.createTask({ title: "From agent path" }, { actor: "agent" });
    });

    expect(screen.getByText("From agent path")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });
});
