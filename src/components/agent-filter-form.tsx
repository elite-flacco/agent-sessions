"use client";

import type { FormEvent, KeyboardEvent, ReactNode } from "react";

interface AgentFilterFormProps {
  children: ReactNode;
}

export function AgentFilterForm({ children }: AgentFilterFormProps) {
  function applySelection(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    const isSelect = target instanceof HTMLSelectElement;
    const isCheckbox =
      target instanceof HTMLInputElement && target.type === "checkbox";

    if (isSelect || isCheckbox) event.currentTarget.requestSubmit();
  }

  function applySearch(event: KeyboardEvent<HTMLFormElement>) {
    const target = event.target;

    if (
      event.key === "Enter" &&
      target instanceof HTMLInputElement &&
      target.type === "search"
    ) {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  }

  return (
    <form
      className="agent-filter-row"
      action="/agents"
      method="get"
      onChange={applySelection}
      onKeyDown={applySearch}
    >
      {children}
    </form>
  );
}
