import { AlertTriangle, X } from "lucide-react";
import Link from "next/link";
import {
  findComparisonDuplicates,
  type AgentCapability,
  type AgentInventory,
} from "@/lib/agent-inventory";
import { countLabel, shortenHomePath } from "@/lib/format";
import { providerDotColors, providerLabels } from "@/lib/labels";
import {
  AgentSetupFilters,
  AgentSetupKind,
  matchesCapability,
  setupHref,
} from "./filters";
import {
  capabilityKindLabels,
  compareCatalogCapabilities,
  inventorySourceFor,
  inventorySourceMeta,
  inventorySources,
  kindIcons,
  kindLabels,
  statusLabels,
  type InventorySource,
} from "./meta";

// The Inventory view shows one provider at a time. Provider and kind stay in a
// compact browsing rail while source, status, and search remain in the stable
// toolbar above the catalog.
const RAIL_KINDS: Exclude<AgentSetupKind, "instruction">[] = [
  "skill",
  "plugin",
  "mcp",
];

export function InventoryView({
  inventories,
  filters,
}: {
  inventories: AgentInventory[];
  filters: AgentSetupFilters;
}) {
  const inventory =
    inventories.find((entry) => entry.provider === filters.provider) ??
    inventories[0];

  if (!inventory) {
    return (
      <div className="card empty-state agent-empty-state">
        <h3>No agents found.</h3>
      </div>
    );
  }

  // Search filtered, but NOT kind — the rail owns kind selection and therefore
  // remains visible while the catalog changes.
  const matched = inventory.capabilities
    .filter((capability) => matchesCapability(capability, filters, true))
    .sort(compareCatalogCapabilities);

  const kindCounts = Object.fromEntries(
    RAIL_KINDS.map((kind) => [
      kind,
      matched.filter((capability) => capability.kind === kind).length,
    ]),
  ) as Record<(typeof RAIL_KINDS)[number], number>;
  // The rail entry renders whenever the provider ships an instruction file, so
  // selecting another kind never hides it. Whether the instruction *matches*
  // the active status/search filters is a separate question, and only decides
  // whether it can stand in as a result when nothing else does.
  const hasInstruction = Boolean(inventory.instructionFile);
  const instructionMatches = showsInstruction(inventory, filters);

  // Honour explicit rail selections even when the active filters produce an
  // empty pane. Without that, filtering Skills could unexpectedly jump to MCPs.
  const requested = filters.kind;
  const selectedKind: AgentSetupKind =
    requested === "instruction" && hasInstruction
      ? "instruction"
      : requested && requested !== "instruction"
        ? requested
        : (RAIL_KINDS.find((kind) => kindCounts[kind] > 0) ??
          (instructionMatches ? "instruction" : "skill"));

  const selected =
    selectedKind === "instruction"
      ? []
      : matched.filter((capability) => capability.kind === selectedKind);

  // Duplicate-name disambiguation is scoped to the rendered pane, not the
  // whole inventory: a name shared across kinds (e.g. the "github" plugin and
  // the "github" MCP) is unique within each kind's pane, so only same-pane
  // collisions get the path hint.
  const duplicateNames = new Set<string>();
  const nameCounts = new Map<string, number>();
  for (const capability of selected) {
    nameCounts.set(capability.name, (nameCounts.get(capability.name) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) duplicateNames.add(name);
  }

  const selectedCapability = filters.selected
    ? inventory.capabilities.find(
        (capability) =>
          capability.id === filters.selected &&
          capability.status !== "disabled",
      )
    : undefined;
  const sourceGroups = partitionByCatalogSource(selected);

  return (
    <div className="agent-inventory-region">
      {inventory.warnings.length > 0 ? (
        <div className="agent-warning-list">
          {inventory.warnings.map((warning) => (
            <div
              key={`${warning.sourcePath}:${warning.code}`}
              className="notice"
            >
              <AlertTriangle size={14} />
              <span>{warning.message}</span>
              <code>{warning.sourcePath}</code>
            </div>
          ))}
        </div>
      ) : null}
      <div
        className={
          selectedCapability
            ? "agent-inventory-layout has-inspector"
            : "agent-inventory-layout"
        }
      >
        <aside className="agent-inventory-rail" aria-label="Inventory browsing">
          <nav className="agent-rail-section" aria-label="Agent provider">
            <div className="agent-rail-heading">Provider</div>
            {inventories.map((entry) => {
              const count = entry.capabilities.filter(
                (capability) => capability.status !== "disabled",
              ).length;
              return (
                <Link
                  key={entry.provider}
                  href={setupHref(filters, {
                    provider: entry.provider,
                    selected: undefined,
                  })}
                  className={
                    entry.provider === inventory.provider
                      ? "agent-provider-rail-item is-active"
                      : "agent-provider-rail-item"
                  }
                  aria-current={
                    entry.provider === inventory.provider ? "true" : undefined
                  }
                >
                  <span
                    className={`agent-provider-dot ${providerDotColors[entry.provider]}`}
                    aria-hidden="true"
                  />
                  <span>{providerLabels[entry.provider]}</span>
                  <span className="agent-kind-rail-count">{count}</span>
                </Link>
              );
            })}
          </nav>
          <nav className="agent-rail-section" aria-label="Capability kind">
            <div className="agent-rail-heading">Kind</div>
            {RAIL_KINDS.map((kind) => (
              <KindRailItem
                key={kind}
                kind={kind}
                count={kindCounts[kind]}
                active={selectedKind === kind}
                href={setupHref(filters, {
                  kind,
                  selected: undefined,
                })}
              />
            ))}
            {hasInstruction ? (
              <KindRailItem
                kind="instruction"
                count={1}
                active={selectedKind === "instruction"}
                href={setupHref(filters, {
                  kind: "instruction",
                  selected: undefined,
                })}
              />
            ) : null}
          </nav>
        </aside>
        <section className="min-w-0" aria-label="Capability catalog">
          <header className="agent-catalog-heading">
            <div>
              <strong className="text-sm">{kindLabels[selectedKind]}</strong>
              <span className="text-muted-foreground">
                {countLabel(selected.length, "item")}
              </span>
            </div>
          </header>
          {selectedKind === "instruction" && inventory.instructionFile ? (
            <details className="agent-instruction" open>
              <summary>
                <strong className="agent-instruction-title">
                  {inventory.instructionFile.filename}
                </strong>
                <span>{inventory.instructionFile.sourcePath}</span>
              </summary>
              <pre>{inventory.instructionFile.content}</pre>
            </details>
          ) : sourceGroups.length > 0 ? (
            <>
              <div className="agent-catalog-columns" aria-hidden="true">
                <span>Name</span>
                <span>Package / source</span>
                <span>Location / detail</span>
              </div>
              <div className="agent-capability-list">
                {sourceGroups.map((group) => (
                  <CatalogSourceGroup
                    key={group.source}
                    source={group.source}
                    capabilities={group.capabilities}
                    filters={filters}
                    duplicateNames={duplicateNames}
                    selectedId={selectedCapability?.id}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="agent-kind-empty">
              <strong>No capabilities match these filters.</strong>
              <p>Adjust the search, source, or status selection.</p>
            </div>
          )}
        </section>
        {selectedCapability ? (
          <CapabilityInspector
            capability={selectedCapability}
            inventory={inventory}
            filters={filters}
          />
        ) : null}
      </div>
    </div>
  );
}

function KindRailItem({
  kind,
  count,
  active,
  href,
}: {
  kind: AgentSetupKind;
  count: number;
  active: boolean;
  href: string;
}) {
  const KindIcon = kindIcons[kind];
  return (
    <Link
      href={href}
      className={
        active ? "agent-kind-rail-item is-active" : "agent-kind-rail-item"
      }
      aria-current={active ? "true" : undefined}
    >
      <KindIcon aria-hidden="true" size={15} />
      <span>{kindLabels[kind]}</span>
      <span className="agent-kind-rail-count">{count}</span>
    </Link>
  );
}

// Whether the instruction file survives the active search filter. Kind is
// deliberately not consulted: the rail owns that dimension, the same way
// `matchesCapability` ignores it for the other kinds.
function showsInstruction(
  inventory: AgentInventory,
  filters: AgentSetupFilters,
): boolean {
  if (!inventory.instructionFile) return false;
  if (!filters.q) return true;
  const query = filters.q.toLocaleLowerCase();
  return [
    inventory.instructionFile.filename,
    inventory.instructionFile.sourcePath,
  ].some((value) => value.toLocaleLowerCase().includes(query));
}

function partitionByCatalogSource(
  capabilities: AgentCapability[],
): { source: InventorySource; capabilities: AgentCapability[] }[] {
  const groups = new Map<InventorySource, AgentCapability[]>();
  for (const capability of capabilities) {
    const source = inventorySourceFor(capability);
    const members = groups.get(source) ?? [];
    members.push(capability);
    groups.set(source, members);
  }
  return inventorySources.flatMap((source) => {
    const members = groups.get(source);
    return members ? [{ source, capabilities: members }] : [];
  });
}

function catalogSourceTitle(
  source: InventorySource,
  capabilities: AgentCapability[],
): string {
  const label = inventorySourceMeta[source].label;
  const kind = capabilities[0]?.kind;
  return kind === "skill" ? `${label} skills` : label;
}

function catalogPackageSource(capability: AgentCapability): string {
  if (capability.sourcePlugin) return capability.sourcePlugin;
  if (capability.sourceRepository) return capability.sourceRepository;
  if (inventorySourceFor(capability) === "built_in") return "Agent runtime";
  if (inventorySourceFor(capability) === "personal") return "Personal install";
  return "Direct install";
}

function catalogLocationDetail(capability: AgentCapability): string {
  if (capability.sourcePath) return shortenHomePath(capability.sourcePath);
  const source = inventorySourceFor(capability);
  if (source === "plugin") return "Bundled with plugin";
  if (source === "built_in") return "Included with runtime";
  if (source === "marketplace") return "Managed install";
  return "Installed globally";
}

function CatalogSourceGroup({
  source,
  capabilities,
  filters,
  duplicateNames,
  selectedId,
}: {
  source: InventorySource;
  capabilities: AgentCapability[];
  filters: AgentSetupFilters;
  duplicateNames: Set<string>;
  selectedId?: string;
}) {
  const meta = inventorySourceMeta[source];
  const SourceIcon = meta.icon;
  const sorted = [...capabilities].sort(compareCatalogCapabilities);
  const shouldGroupPlugins =
    source === "plugin" && capabilities[0]?.kind === "skill";
  const pluginGroups = new Map<string, AgentCapability[]>();
  if (shouldGroupPlugins) {
    for (const capability of sorted) {
      const plugin = capability.sourcePlugin ?? "Plugin source unavailable";
      const members = pluginGroups.get(plugin) ?? [];
      members.push(capability);
      pluginGroups.set(plugin, members);
    }
  }

  return (
    <details className="agent-source-group" open>
      <summary className="agent-source-group-heading">
        <span className="agent-source-group-heading-copy">
          <SourceIcon aria-hidden="true" size={15} />
          <strong>{catalogSourceTitle(source, capabilities)}</strong>
          <span>{meta.description}</span>
        </span>
        <span>{countLabel(capabilities.length, "item")}</span>
      </summary>
      <div className="agent-source-group-body">
        {shouldGroupPlugins
          ? [...pluginGroups.entries()].map(([plugin, members]) => (
              <PluginSkillGroup
                key={plugin}
                plugin={plugin}
                members={members}
                filters={filters}
                duplicateNames={duplicateNames}
                selectedId={selectedId}
              />
            ))
          : sorted.map((capability) => (
              <CatalogCapabilityRow
                key={capability.id}
                capability={capability}
                filters={filters}
                duplicateNames={duplicateNames}
                selected={selectedId === capability.id}
              />
            ))}
      </div>
    </details>
  );
}

function pluginGroupStatus(
  members: AgentCapability[],
): AgentCapability["status"] {
  if (members.some((capability) => capability.status === "unavailable")) {
    return "unavailable";
  }
  return members.every((capability) => capability.status === "enabled")
    ? "enabled"
    : "installed";
}

function PluginSkillGroup({
  plugin,
  members,
  filters,
  duplicateNames,
  selectedId,
}: {
  plugin: string;
  members: AgentCapability[];
  filters: AgentSetupFilters;
  duplicateNames: Set<string>;
  selectedId?: string;
}) {
  const status = pluginGroupStatus(members);
  const source = members[0]?.sourceRepository ?? "Plugin package";
  return (
    <details className="agent-plugin-group">
      <summary className="agent-catalog-grid">
        <span className="agent-plugin-group-name">
          <span className="stacked-copy">
            <strong>{plugin}</strong>
          </span>
        </span>
        <span className="agent-catalog-source">{source}</span>
        <span className="agent-catalog-detail">
          {countLabel(members.length, "skill")}
          {status === "unavailable" ? (
            <span className="agent-unavailable-inline">
              {statusLabels.unavailable}
            </span>
          ) : null}
        </span>
      </summary>
      <div className="agent-plugin-group-members">
        {members.map((capability) => (
          <CatalogCapabilityRow
            key={capability.id}
            capability={capability}
            filters={filters}
            duplicateNames={duplicateNames}
            selected={selectedId === capability.id}
            withinPlugin
          />
        ))}
      </div>
    </details>
  );
}

function CatalogCapabilityRow({
  capability,
  filters,
  duplicateNames,
  selected,
  withinPlugin,
}: {
  capability: AgentCapability;
  filters: AgentSetupFilters;
  duplicateNames: Set<string>;
  selected: boolean;
  withinPlugin?: boolean;
}) {
  return (
    <Link
      href={setupHref(filters, { selected: capability.id })}
      prefetch={false}
      className={
        withinPlugin
          ? "agent-catalog-row agent-catalog-grid agent-catalog-row-child"
          : "agent-catalog-row agent-catalog-grid"
      }
      aria-current={selected ? "true" : undefined}
    >
      <span className="agent-catalog-name">
        <strong>{capability.name}</strong>
      </span>
      <span className="agent-catalog-source">
        {catalogPackageSource(capability)}
      </span>
      <span className="agent-catalog-detail">
        {capability.sourcePath ? (
          <code>{catalogLocationDetail(capability)}</code>
        ) : (
          catalogLocationDetail(capability)
        )}
        {capability.status === "unavailable" ? (
          <span className="agent-unavailable-inline">
            {statusLabels.unavailable}
          </span>
        ) : null}
        {duplicateNames.has(capability.name) ? (
          <span className="agent-duplicate-inline">Duplicate install</span>
        ) : null}
      </span>
    </Link>
  );
}

function CapabilityInspector({
  capability,
  inventory,
  filters,
}: {
  capability: AgentCapability;
  inventory: AgentInventory;
  filters: AgentSetupFilters;
}) {
  const KindIcon = kindIcons[capability.kind];
  const source = inventorySourceFor(capability);
  const duplicate = findComparisonDuplicates([inventory]).find(
    (entry) => entry.kind === capability.kind && entry.name === capability.name,
  );
  return (
    <aside className="agent-catalog-inspector" aria-label="Selected capability">
      <header className="agent-inspector-heading">
        <div>
          <KindIcon aria-hidden="true" size={16} />
          <div className="stacked-copy">
            <strong>{capability.name}</strong>
            <span className="text-muted-foreground">
              {capabilityKindLabels[capability.kind]}
            </span>
          </div>
        </div>
        <Link
          href={setupHref(filters, { selected: undefined })}
          className="agent-inspector-close"
          aria-label="Close inspector"
        >
          <X aria-hidden="true" size={15} />
        </Link>
      </header>
      <dl className="agent-inspector-details">
        <div>
          <dt>Provider</dt>
          <dd>{providerLabels[inventory.provider]}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{inventorySourceMeta[source].label}</dd>
        </div>
        {capability.sourcePlugin ? (
          <div>
            <dt>Parent plugin</dt>
            <dd>{capability.sourcePlugin}</dd>
          </div>
        ) : null}
        <div>
          <dt>Package / source</dt>
          <dd>{catalogPackageSource(capability)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{statusLabels[capability.status]}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>
            <code className="text-muted-foreground text-xs">
              {catalogLocationDetail(capability)}
            </code>
          </dd>
        </div>
      </dl>
      {duplicate ? (
        <section className="agent-inspector-duplicates">
          <header>
            <strong className="text-xs">Duplicate installs</strong>
            <span className="text-muted-foreground">
              {countLabel(duplicate.copies.length, "location")}
            </span>
          </header>
          <p className="text-muted-foreground">
            {duplicate.identicalContent
              ? "Copies have matching content."
              : "Copies may differ; review which install should take precedence."}
          </p>
          <div>
            {duplicate.copies.map((copy) =>
              copy.sourcePath ? (
                <code key={copy.id}>{shortenHomePath(copy.sourcePath)}</code>
              ) : null,
            )}
          </div>
        </section>
      ) : null}
    </aside>
  );
}
