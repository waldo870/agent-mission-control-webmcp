import type { Task } from "../types";

/**
 * Presentation-only: seed the board with a realistic starter
 * mission when storage is empty so the demo opens into something
 * that looks like a real coordination session between a human and
 * an agent.
 *
 * This NEVER runs when localStorage already has data — existing
 * demo state is preserved.
 */
export function defaultMissionSeed(): Task[] {
  const now = Date.now();
  return [
    {
      id: "seed-1",
      title: "Draft the workshop agenda",
      description: "Outline the three sessions, key takeaways, and target audience.",
      status: "done",
      createdAt: now - 1000 * 60 * 60 * 24 * 5,
      lastUpdatedAt: now - 1000 * 60 * 60 * 24 * 1,
      createdBy: "human",
    },
    {
      id: "seed-2",
      title: "Confirm venue and A/V",
      description: "Book Room 4B, run a sound check on Thursday afternoon.",
      status: "doing",
      createdAt: now - 1000 * 60 * 60 * 24 * 3,
      lastUpdatedAt: now - 1000 * 60 * 60 * 4,
      createdBy: "human",
    },
    {
      id: "seed-3",
      title: "Recruit 8 beta testers",
      description: "Ask product team for two names each; deadline end of week.",
      status: "todo",
      createdAt: now - 1000 * 60 * 60 * 24 * 2,
      lastUpdatedAt: now - 1000 * 60 * 60 * 24 * 2,
      createdBy: "agent",
    },
    {
      id: "seed-4",
      title: "Polish the demo walkthrough",
      description: "Tighten the opening 90 seconds; cut slides 7 and 12.",
      status: "todo",
      createdAt: now - 1000 * 60 * 60 * 6,
      lastUpdatedAt: now - 1000 * 60 * 60 * 6,
      createdBy: "agent",
    },
  ];
}
