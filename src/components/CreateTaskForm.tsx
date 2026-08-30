import { useState, type FormEvent } from "react";
import type { TaskService } from "../services/taskService";

interface Props {
  service: TaskService;
}

export function CreateTaskForm({ service }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      service.createTask(
        { title, description: description || undefined },
        { actor: "human" },
      );
      setTitle("");
      setDescription("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create task.");
    }
  }

  return (
    <form className="create-task-form" onSubmit={handleSubmit} aria-label="Create task">
      <label className="field">
        <span>Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
          placeholder="e.g. Draft WebMCP outline"
        />
      </label>
      <label className="field">
        <span>Description (optional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="Add a few more details"
        />
      </label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button type="submit" className="primary">
        Add task
      </button>
    </form>
  );
}
