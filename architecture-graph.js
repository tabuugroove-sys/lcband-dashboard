"use strict";

(function architectureAtlas() {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MAX_SLICE_NODES = 180;
  const OVERVIEW_CACHE_KEY = "lcband_architecture_graph_overview_v1";
  const API = {
    overview: "/api/architecture-graph/overview",
    cluster: (id) => `/api/architecture-graph/clusters/${encodeURIComponent(id)}`,
    search: (query) => `/api/architecture-graph/search?q=${encodeURIComponent(query)}`,
    trace: (symbol) => `/api/architecture-graph/trace?symbol=${encodeURIComponent(symbol)}`,
    casesSearch: (query) => `/api/architecture-graph/cases/search?q=${encodeURIComponent(query)}`,
    caseTrace: (ref) => `/api/architecture-graph/cases/${encodeURIComponent(ref)}/trace`,
  };

  const dom = {};
  const state = {
    lens: "architecture",
    overview: null,
    stack: [],
    operation: 0,
    selected: null,
    selectedAction: null,
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function firstDefined(object, keys, fallback) {
    if (!object || typeof object !== "object") return fallback;
    for (const key of keys) {
      if (object[key] !== undefined && object[key] !== null && object[key] !== "") {
        return object[key];
      }
    }
    return fallback;
  }

  function toFiniteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[\s,_]/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function formatNumber(value) {
    const number = toFiniteNumber(value);
    return number === null ? "—" : new Intl.NumberFormat("ru-RU").format(number);
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function textValue(value, maxLength = 700) {
    if (value === undefined || value === null || value === "") return "";
    let text;
    if (Array.isArray(value)) {
      text = value.map((item) => {
        if (item && typeof item === "object") {
          return firstDefined(item, ["label", "name", "id", "code", "reason"], "");
        }
        return String(item);
      }).filter(Boolean).join(", ");
    } else if (typeof value === "object") {
      text = firstDefined(value, ["label", "name", "id", "code", "reason", "status"], "");
      if (!text) {
        try { text = JSON.stringify(value); } catch (_error) { text = ""; }
      }
    } else {
      text = String(value);
    }
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }

  function unwrap(payload) {
    if (!payload || typeof payload !== "object") return payload || {};
    if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
      return payload.data;
    }
    if (payload.result && typeof payload.result === "object" && !Array.isArray(payload.result)) {
      return payload.result;
    }
    return payload;
  }

  function canonicalKind(raw, fallback = "code_graph") {
    const value = String(raw || "").toLowerCase().replace(/[\s-]+/g, "_");
    if (["recorded", "recorded_fact", "fact", "runtime", "observed", "event"].includes(value)) return "recorded";
    if (["code", "code_graph", "static", "static_code", "calls", "imports", "usage", "defines"].includes(value)) return "code_graph";
    if (["policy", "rule", "gate", "selector", "routing_rule", "decision_rule"].includes(value)) return "policy";
    if (["inferred", "inference", "derived", "hypothesis"].includes(value)) return "inferred";
    if (["gap", "evidence_gap", "missing", "unknown", "unproven"].includes(value)) return "gap";
    return fallback;
  }

  function kindLabel(kind) {
    const labels = {
      recorded: "записанный факт",
      code_graph: "статический код",
      policy: "правило / политика",
      inferred: "вывод",
      gap: "пробел доказательств",
    };
    return labels[canonicalKind(kind)] || "источник не указан";
  }

  function safeClass(value) {
    return String(value || "unknown").toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createSvg(tag, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => {
      if (value !== undefined && value !== null) element.setAttribute(key, String(value));
    });
    return element;
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      let payload = {};
      try { payload = await response.json(); } catch (_error) { payload = {}; }
      if (!response.ok) {
        const detail = firstDefined(payload, ["message", "error", "detail", "reason"], `HTTP ${response.status}`);
        const error = new Error(textValue(detail) || `HTTP ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Источник не ответил за 20 секунд");
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function normalizeId(value, fallback) {
    if (value && typeof value === "object") {
      value = firstDefined(value, ["id", "node_id", "qualified_name", "name", "ref"], "");
    }
    return textValue(value, 320) || fallback;
  }

  function normalizeNode(raw, index, fallbackKind = "code_graph") {
    const item = raw && typeof raw === "object" ? raw : { name: String(raw || "") };
    const type = textValue(firstDefined(item, ["type", "node_type", "symbol_type", "entity_type", "category"], "symbol"), 80);
    const id = normalizeId(firstDefined(item, ["id", "node_id", "cluster_id", "qualified_name", "symbol", "ref", "name"], ""), `node-${index}`);
    const label = textValue(firstDefined(item, ["label", "title", "display_name", "name", "qualified_name", "symbol", "id", "node_id"], id), 260);
    const provenanceRaw = firstDefined(item, ["evidence_kind", "provenance", "evidence_type", "fact_type"], "");
    const fallback = /decision|gate|rule|policy/i.test(type) ? "policy" : fallbackKind;
    const kind = canonicalKind(provenanceRaw || firstDefined(item, ["kind"], ""), fallback);
    const count = toFiniteNumber(firstDefined(item, ["node_count", "members_count", "symbol_count", "count", "size"], null));
    const qualifiedName = textValue(firstDefined(item, ["qualified_name", "symbol", "function_name", "class_name"], ""), 320);
    const clusterId = textValue(firstDefined(item, ["cluster_id", "cluster", "community_id"], ""), 160);
    const caseRef = textValue(firstDefined(item, ["case_ref", "ref", "order_ref"], ""), 180);
    const summary = textValue(firstDefined(item, ["summary", "description", "note", "reason", "explanation", "decision"], ""));
    return {
      id,
      label,
      type,
      kind,
      count,
      qualifiedName,
      clusterId,
      caseRef,
      summary,
      raw: item,
      isRoot: Boolean(item.is_root || item.root),
      pathIndex: toFiniteNumber(firstDefined(item, ["path_index", "sequence", "step", "position"], null)),
    };
  }

  function normalizeEdge(raw, index, fallbackKind = "code_graph") {
    const item = raw && typeof raw === "object" ? raw : {};
    const relation = textValue(firstDefined(item, ["relation", "edge_type", "type", "label", "kind"], ""), 100);
    const provenance = firstDefined(item, ["evidence_kind", "provenance", "evidence_type", "fact_type"], "");
    return {
      id: normalizeId(firstDefined(item, ["id", "edge_id"], ""), `edge-${index}`),
      source: normalizeId(firstDefined(item, ["source", "from", "source_id", "caller", "start"], ""), ""),
      target: normalizeId(firstDefined(item, ["target", "to", "target_id", "callee", "end"], ""), ""),
      kind: canonicalKind(provenance || relation, fallbackKind),
      label: relation,
      isPath: Boolean(item.is_path || item.on_path || item.highlighted || item.active),
      raw: item,
    };
  }

  function uniqueNodes(rawNodes, fallbackKind) {
    const nodes = [];
    const ids = new Set();
    const aliases = new Map();
    asArray(rawNodes).slice(0, MAX_SLICE_NODES).forEach((raw, index) => {
      const node = normalizeNode(raw, index, fallbackKind);
      let id = node.id;
      let suffix = 2;
      while (ids.has(id)) {
        id = `${node.id}#${suffix}`;
        suffix += 1;
      }
      node.id = id;
      ids.add(id);
      nodes.push(node);
      const item = node.raw;
      [item.id, item.node_id, item.qualified_name, item.symbol, item.name, node.id].forEach((alias) => {
        if (alias !== undefined && alias !== null && String(alias)) aliases.set(String(alias), node.id);
      });
    });
    return { nodes, aliases };
  }

  function normalizePath(rawPath) {
    if (!Array.isArray(rawPath)) return [];
    return rawPath.map((item) => normalizeId(item, "")).filter(Boolean);
  }

  function normalizeGaps(raw) {
    return asArray(raw).map((gap, index) => {
      if (gap && typeof gap === "object") {
        return {
          id: normalizeId(firstDefined(gap, ["id", "gap_id"], ""), `gap-${index}`),
          label: textValue(firstDefined(gap, ["label", "reason", "message", "expected_next", "missing"], "Неизвестный пробел")),
          raw: gap,
        };
      }
      return { id: `gap-${index}`, label: textValue(gap) || "Неизвестный пробел", raw: {} };
    });
  }

  function normalizeGraph(payload, options = {}) {
    const data = unwrap(payload);
    const graph = data.graph && typeof data.graph === "object" ? data.graph : data;
    const fallbackKind = options.fallbackKind || "code_graph";
    let rawNodes = firstDefined(graph, ["nodes", "members", "symbols", "steps"], []);
    if (!Array.isArray(rawNodes) || !rawNodes.length) {
      rawNodes = firstDefined(data, ["nodes", "members", "symbols", "steps", "timeline", "decisions"], []);
    }

    let central = firstDefined(data, ["center", "central", "symbol", "root", "central_function"], null);
    if (typeof central === "string") central = { id: central, label: central, qualified_name: central, is_root: true };
    const callers = asArray(firstDefined(data, ["callers", "inbound"], []));
    const callees = asArray(firstDefined(data, ["callees", "outbound"], []));
    if ((!Array.isArray(rawNodes) || !rawNodes.length) && central) {
      rawNodes = [Object.assign({}, central, { is_root: true }), ...callers, ...callees];
    }

    const unique = uniqueNodes(rawNodes, fallbackKind);
    const nodes = unique.nodes;
    const aliases = unique.aliases;
    let rawEdges = firstDefined(graph, ["edges", "links", "relations"], []);
    if (!Array.isArray(rawEdges) || !rawEdges.length) rawEdges = firstDefined(data, ["edges", "links", "relations"], []);
    const edges = asArray(rawEdges).map((edge, index) => normalizeEdge(edge, index, fallbackKind));

    if (!edges.length && central && nodes.length) {
      const centerId = nodes[0].id;
      callers.forEach((caller, index) => {
        const alias = normalizeId(caller, "");
        edges.push({ id: `caller-${index}`, source: aliases.get(alias) || alias, target: centerId, kind: "code_graph", label: "CALLS", isPath: false, raw: {} });
      });
      callees.forEach((callee, index) => {
        const alias = normalizeId(callee, "");
        edges.push({ id: `callee-${index}`, source: centerId, target: aliases.get(alias) || alias, kind: "code_graph", label: "CALLS", isPath: false, raw: {} });
      });
    }

    edges.forEach((edge) => {
      edge.source = aliases.get(String(edge.source)) || edge.source;
      edge.target = aliases.get(String(edge.target)) || edge.target;
    });
    const validIds = new Set(nodes.map((node) => node.id));
    const validEdges = edges.filter((edge) => edge.source && edge.target && validIds.has(edge.source) && validIds.has(edge.target));

    let path = normalizePath(firstDefined(data, ["path", "highlighted_path", "recorded_path", "node_path"], []));
    path = path.map((id) => aliases.get(String(id)) || id).filter((id) => validIds.has(id));
    if (!path.length) {
      path = nodes.filter((node) => node.pathIndex !== null).sort((a, b) => a.pathIndex - b.pathIndex).map((node) => node.id);
    }
    const pathSet = new Set(path);
    validEdges.forEach((edge) => {
      if (!edge.isPath && path.length > 1) {
        edge.isPath = pathSet.has(edge.source) && pathSet.has(edge.target);
      }
    });

    const gaps = normalizeGaps(firstDefined(data, ["evidence_gaps", "gaps", "missing_evidence"], []));
    if (options.caseMode && gaps.length && !nodes.some((node) => node.kind === "gap")) {
      const fallbackSource = nodes.length ? nodes[nodes.length - 1].id : "";
      gaps.forEach((gap, index) => {
        const gapNode = normalizeNode({
          id: `evidence-gap:${gap.id}`,
          label: gap.label,
          type: "evidence gap",
          evidence_kind: "gap",
          summary: gap.label,
        }, nodes.length + index, "gap");
        nodes.push(gapNode);
        validIds.add(gapNode.id);
        const rawSource = normalizeId(firstDefined(gap.raw, ["source", "source_id", "after_node", "node_id"], ""), "");
        const source = aliases.get(String(rawSource)) || (validIds.has(rawSource) ? rawSource : fallbackSource);
        if (source) {
          validEdges.push({
            id: `evidence-gap-edge-${index}`,
            source,
            target: gapNode.id,
            kind: "gap",
            label: "MISSING_EVIDENCE",
            isPath: false,
            raw: gap.raw,
          });
        }
      });
    }
    const timelineRaw = firstDefined(data, ["timeline", "decisions", "steps", "events"], []);
    const timeline = asArray(timelineRaw).map((item, index) => normalizeNode(item, index, options.caseMode ? "recorded" : fallbackKind));

    if (options.caseMode && !path.length) {
      nodes.forEach((node, index) => {
        if (node.kind !== "gap") {
          node.pathIndex = node.pathIndex === null ? index : node.pathIndex;
          path.push(node.id);
        }
      });
      validEdges.forEach((edge) => { edge.isPath = edge.kind !== "gap"; });
    }

    return {
      nodes,
      edges: validEdges,
      path,
      gaps,
      timeline: timeline.length ? timeline : nodes.filter((node) => /decision|gate|selection|classification|route|candidate|receipt|request/i.test(node.type)),
      title: textValue(firstDefined(data, ["title", "label", "case_label", "symbol"], options.title || ""), 260),
      summary: textValue(firstDefined(data, ["summary", "explanation", "reason", "description"], "")),
      meta: data,
      layout: options.layout || (options.caseMode ? "timeline" : "flow"),
      viewType: options.viewType || "graph",
    };
  }

  function normalizeOverview(payload) {
    const data = unwrap(payload);
    const rawIndex = firstDefined(data, ["index", "graph_index", "index_status", "status"], {});
    const counts = firstDefined(data, ["counts", "graph_counts"], {});
    const index = rawIndex && typeof rawIndex === "object"
      ? rawIndex
      : {
          status: rawIndex,
          node_count: firstDefined(counts, ["nodes", "node_count"], firstDefined(data, ["node_count", "total_nodes"], null)),
          edge_count: firstDefined(counts, ["edges", "edge_count"], firstDefined(data, ["edge_count", "total_edges"], null)),
        };
    let rawClusters = firstDefined(data, ["clusters", "categories", "communities", "architecture_clusters"], []);
    if (!Array.isArray(rawClusters) && rawClusters && typeof rawClusters === "object") {
      rawClusters = firstDefined(rawClusters, ["clusters", "categories", "communities"], []);
    }
    if (!Array.isArray(rawClusters)) rawClusters = [];

    const clusters = rawClusters.slice(0, 40).map((item, indexValue) => {
      const node = normalizeNode(item, indexValue, "code_graph");
      node.clusterId = textValue(firstDefined(item, ["id", "cluster_id", "slug", "community_id"], node.id), 160);
      node.id = `cluster:${node.clusterId}`;
      node.type = textValue(firstDefined(item, ["type", "category", "cluster_type"], "architecture cluster"), 80);
      return node;
    });

    let nodes;
    let edges;
    if (clusters.length) {
      const root = normalizeNode({
        id: "architecture-root",
        label: firstDefined(data, ["project_label", "project", "name"], "LCBand"),
        type: "project",
        kind: "code_graph",
        is_root: true,
        node_count: firstDefined(index, ["node_count", "nodes", "total_nodes"], firstDefined(data, ["node_count", "nodes"], null)),
        summary: "Индексированный проект. Откройте архитектурную категорию, чтобы увидеть ограниченный срез символов.",
      }, 0, "code_graph");
      nodes = [root, ...clusters];
      edges = clusters.map((cluster, indexValue) => ({
        id: `overview-edge-${indexValue}`,
        source: root.id,
        target: cluster.id,
        kind: cluster.kind,
        label: "CONTAINS",
        isPath: false,
        raw: {},
      }));
      asArray(data.edges).forEach((rawEdge, indexValue) => {
        const edge = normalizeEdge(rawEdge, indexValue, "policy");
        const source = edge.source.startsWith("cluster:") ? edge.source : `cluster:${edge.source}`;
        const target = edge.target.startsWith("cluster:") ? edge.target : `cluster:${edge.target}`;
        if (nodes.some((node) => node.id === source) && nodes.some((node) => node.id === target)) {
          edges.push(Object.assign(edge, { id: `overview-flow-${indexValue}`, source, target }));
        }
      });
    } else {
      const graph = normalizeGraph(data, { layout: "overview", viewType: "overview" });
      nodes = graph.nodes;
      edges = graph.edges;
    }

    return {
      nodes,
      edges,
      path: [],
      gaps: [],
      timeline: [],
      title: "Архитектурные категории LCBand",
      summary: textValue(firstDefined(data, ["summary", "description"], "")),
      meta: data,
      index,
      clusters,
      layout: "overview",
      viewType: "overview",
    };
  }

  function normalizeCluster(payload, clusterId, clusterLabel) {
    const data = unwrap(payload);
    const graph = normalizeGraph(data, {
      layout: "flow",
      viewType: "cluster",
      title: clusterLabel,
    });
    const cluster = firstDefined(data, ["cluster", "category", "community"], {});
    const resolvedLabel = textValue(firstDefined(cluster, ["label", "name", "title"], firstDefined(data, ["label", "title"], clusterLabel)), 260);
    const existingRoot = graph.nodes.find((node) => node.id === `cluster:${clusterId}` || /cluster/i.test(node.type));
    const rootId = existingRoot ? existingRoot.id : `cluster-root:${clusterId}`;
    if (existingRoot) {
      existingRoot.isRoot = true;
    } else {
      const root = normalizeNode({
        id: rootId,
        label: resolvedLabel || clusterLabel || clusterId,
        type: "cluster",
        kind: "code_graph",
        is_root: true,
        summary: firstDefined(cluster, ["summary", "description"], firstDefined(data, ["summary", "description"], "")),
      }, 0, "code_graph");
      graph.nodes.unshift(root);
      const targets = graph.nodes.slice(1);
      const connectedTargets = new Set(graph.edges.map((edge) => edge.target));
      targets.forEach((node, index) => {
        if (!connectedTargets.has(node.id)) {
          graph.edges.push({
            id: `cluster-member-${index}`,
            source: rootId,
            target: node.id,
            kind: "code_graph",
            label: "CONTAINS",
            isPath: false,
            raw: {},
          });
        }
      });
    }
    graph.title = resolvedLabel || clusterLabel || clusterId;
    graph.clusterId = clusterId;
    return graph;
  }

  function normalizeResults(payload, type) {
    const data = unwrap(payload);
    let raw = firstDefined(data, ["results", "matches", type === "case" ? "cases" : "symbols", "items"], []);
    if (!Array.isArray(raw) && Array.isArray(payload)) raw = payload;
    return asArray(raw).slice(0, 60).map((item, index) => {
      const node = normalizeNode(item, index, type === "case" ? "recorded" : "code_graph");
      if (type === "case") {
        node.caseRef = textValue(firstDefined(item, ["ref", "case_ref", "order_ref", "id", "order_id"], node.id), 180);
      }
      return node;
    });
  }

  function resultsGraph(results, type, query) {
    const root = normalizeNode({
      id: `${type}-search-root`,
      label: `«${query}»`,
      type: type === "case" ? "case search" : "symbol search",
      kind: type === "case" ? "recorded" : "code_graph",
      is_root: true,
      count: results.length,
      summary: `Найдено: ${results.length}`,
    }, 0, type === "case" ? "recorded" : "code_graph");
    const nodes = [root, ...results];
    const edges = results.map((result, index) => ({
      id: `result-${index}`,
      source: root.id,
      target: result.id,
      kind: type === "case" ? "recorded" : "code_graph",
      label: "MATCH",
      isPath: false,
      raw: {},
    }));
    return {
      nodes,
      edges,
      path: [],
      gaps: [],
      timeline: [],
      title: type === "case" ? "Найденные лиды и заказы" : "Результаты поиска по индексу",
      summary: "",
      meta: {},
      layout: "flow",
      viewType: type === "case" ? "case-results" : "search-results",
    };
  }

  function nodeAliases(raw) {
    return [raw.id, raw.node_id, raw.qualified_name, raw.name, raw.ref].filter(Boolean).map(String);
  }

  class GraphRenderer {
    constructor(svg, camera, viewport) {
      this.svg = svg;
      this.camera = camera;
      this.viewport = viewport;
      this.data = null;
      this.nodeMap = new Map();
      this.positions = new Map();
      this.selectedId = null;
      this.transform = { x: 0, y: 0, scale: 1 };
      this.drag = null;
      this.suppressClick = false;
      this.onSelect = () => {};
      this.onActivate = () => {};
      this._wireViewport();
    }

    _wireViewport() {
      this.svg.addEventListener("wheel", (event) => {
        event.preventDefault();
        const point = this._clientToViewBox(event.clientX, event.clientY);
        const factor = event.deltaY < 0 ? 1.13 : .885;
        this.zoomAt(point.x, point.y, this.transform.scale * factor);
      }, { passive: false });

      this.svg.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest(".atlas-node")) return;
        const point = this._clientToViewBox(event.clientX, event.clientY);
        this.drag = { pointerId: event.pointerId, x: point.x, y: point.y, startX: this.transform.x, startY: this.transform.y, moved: false };
        this.svg.setPointerCapture(event.pointerId);
        this.viewport.classList.add("is-panning");
      });

      this.svg.addEventListener("pointermove", (event) => {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        const point = this._clientToViewBox(event.clientX, event.clientY);
        const dx = point.x - this.drag.x;
        const dy = point.y - this.drag.y;
        if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
        this.transform.x = this.drag.startX + dx;
        this.transform.y = this.drag.startY + dy;
        this._applyTransform();
      });

      const endDrag = (event) => {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        this.suppressClick = this.drag.moved;
        this.drag = null;
        this.viewport.classList.remove("is-panning");
      };
      this.svg.addEventListener("pointerup", endDrag);
      this.svg.addEventListener("pointercancel", endDrag);
      this.svg.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          this.select(null);
          this.onSelect(null, this.data);
        }
      });
    }

    _clientToViewBox(clientX, clientY) {
      const rect = this.svg.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / Math.max(rect.width, 1)) * 1600,
        y: ((clientY - rect.top) / Math.max(rect.height, 1)) * 920,
      };
    }

    zoomAt(x, y, requestedScale) {
      const scale = clamp(requestedScale, .12, 3.2);
      const worldX = (x - this.transform.x) / this.transform.scale;
      const worldY = (y - this.transform.y) / this.transform.scale;
      this.transform.x = x - worldX * scale;
      this.transform.y = y - worldY * scale;
      this.transform.scale = scale;
      this._applyTransform();
    }

    zoomBy(factor) {
      this.zoomAt(800, 460, this.transform.scale * factor);
    }

    reset() {
      this.transform = { x: 0, y: 0, scale: 1 };
      this._applyTransform();
    }

    fit() {
      if (!this.positions.size) return this.reset();
      const entries = Array.from(this.positions.values());
      const minX = Math.min(...entries.map((pos) => pos.x - pos.width / 2));
      const maxX = Math.max(...entries.map((pos) => pos.x + pos.width / 2));
      const minY = Math.min(...entries.map((pos) => pos.y - pos.height / 2));
      const maxY = Math.max(...entries.map((pos) => pos.y + pos.height / 2));
      const width = Math.max(1, maxX - minX);
      const height = Math.max(1, maxY - minY);
      const scale = clamp(Math.min(1390 / width, 740 / height), .12, 1.35);
      this.transform = {
        x: 800 - ((minX + maxX) / 2) * scale,
        y: 460 - ((minY + maxY) / 2) * scale,
        scale,
      };
      this._applyTransform();
    }

    _applyTransform() {
      this.camera.setAttribute("transform", `translate(${this.transform.x} ${this.transform.y}) scale(${this.transform.scale})`);
      dom.zoomReset.textContent = String(Math.round(this.transform.scale * 100));
      dom.zoomReset.setAttribute("aria-label", `Масштаб ${Math.round(this.transform.scale * 100)} процентов. Сбросить.`);
    }

    setData(data) {
      this.data = data;
      this.selectedId = null;
      this.nodeMap = new Map(data.nodes.map((node) => [node.id, node]));
      this.positions = this._layout(data);
      this._render();
      window.requestAnimationFrame(() => this.fit());
    }

    _nodeSize(node) {
      if (node.isRoot) return { width: 238, height: 88 };
      if (/cluster|category|community/i.test(node.type)) return { width: 222, height: 76 };
      return { width: 202, height: 68 };
    }

    _layout(data) {
      if (data.layout === "overview") return this._layoutOverview(data);
      if (data.layout === "timeline") return this._layoutTimeline(data);
      return this._layoutFlow(data);
    }

    _layoutOverview(data) {
      const positions = new Map();
      const root = data.nodes.find((node) => node.isRoot) || data.nodes[0];
      if (!root) return positions;
      positions.set(root.id, Object.assign({ x: 800, y: 455 }, this._nodeSize(root)));
      const others = data.nodes.filter((node) => node.id !== root.id);
      const radiusX = others.length > 12 ? 650 : 555;
      const radiusY = others.length > 12 ? 360 : 305;
      others.forEach((node, index) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(others.length, 1);
        positions.set(node.id, Object.assign({
          x: 800 + Math.cos(angle) * radiusX,
          y: 455 + Math.sin(angle) * radiusY,
        }, this._nodeSize(node)));
      });
      return positions;
    }

    _layoutTimeline(data) {
      const positions = new Map();
      const byId = new Map(data.nodes.map((node) => [node.id, node]));
      let ordered = data.path.map((id) => byId.get(id)).filter(Boolean);
      const orderedIds = new Set(ordered.map((node) => node.id));
      const rest = data.nodes.filter((node) => !orderedIds.has(node.id));
      if (!ordered.length) ordered = data.nodes.filter((node) => node.kind !== "gap");
      const allNodes = [...ordered, ...rest];
      const columns = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(allNodes.length * 1.55))));
      const rows = Math.max(1, Math.ceil(allNodes.length / columns));
      const startY = 455 - ((rows - 1) * 228) / 2;
      allNodes.forEach((node, index) => {
        const row = Math.floor(index / columns);
        const rawColumn = index % columns;
        const column = row % 2 === 0 ? rawColumn : columns - 1 - rawColumn;
        positions.set(node.id, Object.assign({
          x: 150 + column * 246,
          y: startY + row * 228,
        }, this._nodeSize(node)));
      });
      return positions;
    }

    _layoutFlow(data) {
      const positions = new Map();
      const root = data.nodes.find((node) => node.isRoot) || data.nodes[0];
      if (!root) return positions;
      positions.set(root.id, Object.assign({ x: 170, y: 455 }, this._nodeSize(root)));
      const others = data.nodes.filter((node) => node.id !== root.id);
      const rowsPerColumn = Math.max(1, Math.min(7, Math.ceil(Math.sqrt(others.length * 1.35))));
      others.forEach((node, index) => {
        const column = Math.floor(index / rowsPerColumn);
        const row = index % rowsPerColumn;
        const rowsHere = Math.min(rowsPerColumn, others.length - column * rowsPerColumn);
        const gapY = Math.min(118, 730 / Math.max(rowsHere - 1, 1));
        const startY = 455 - ((rowsHere - 1) * gapY) / 2;
        positions.set(node.id, Object.assign({
          x: 480 + column * 258,
          y: startY + row * gapY,
        }, this._nodeSize(node)));
      });
      return positions;
    }

    _edgePath(source, target) {
      const sx = source.x + source.width / 2;
      const sy = source.y;
      const tx = target.x - target.width / 2;
      const ty = target.y;
      if (tx >= sx - 30) {
        const bend = Math.max(50, Math.abs(tx - sx) * .48);
        return `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
      }
      const vertical = sy <= ty ? 1 : -1;
      return `M ${sx} ${sy} C ${sx + 70} ${sy + vertical * 78}, ${tx - 70} ${ty - vertical * 78}, ${tx} ${ty}`;
    }

    _render() {
      this.camera.replaceChildren();
      if (!this.data.nodes.length) return;
      const pathNodes = new Set(this.data.path);
      const hasPath = pathNodes.size > 0;
      const edgeGroup = createSvg("g", { class: "edge-layer" });
      this.data.edges.forEach((edge) => {
        const source = this.positions.get(edge.source);
        const target = this.positions.get(edge.target);
        if (!source || !target) return;
        const path = createSvg("path", {
          class: `atlas-edge kind-${safeClass(edge.kind)}${edge.isPath ? " is-path" : ""}${hasPath && !edge.isPath && edge.kind !== "gap" ? " is-dimmed" : ""}`,
          d: this._edgePath(source, target),
          "data-edge-id": edge.id,
        });
        const title = createSvg("title");
        title.textContent = `${edge.label || "связь"} · ${kindLabel(edge.kind)}`;
        path.appendChild(title);
        edgeGroup.appendChild(path);
      });
      this.camera.appendChild(edgeGroup);

      const nodeGroup = createSvg("g", { class: "node-layer" });
      this.data.nodes.forEach((node, index) => {
        const pos = this.positions.get(node.id);
        if (!pos) return;
        const group = this._renderNode(node, pos, index, pathNodes, hasPath);
        nodeGroup.appendChild(group);
      });
      this.camera.appendChild(nodeGroup);
    }

    _renderNode(node, pos, index, pathNodes, hasPath) {
      const pathClass = pathNodes.has(node.id) ? " is-path" : "";
      const dimClass = hasPath && !pathNodes.has(node.id) && node.kind !== "gap" ? " is-dimmed" : "";
      const group = createSvg("g", {
        class: `atlas-node kind-${safeClass(node.kind)}${node.isRoot ? " is-root" : ""}${pathClass}${dimClass}`,
        transform: `translate(${pos.x - pos.width / 2} ${pos.y - pos.height / 2})`,
        tabindex: "0",
        role: "button",
        "aria-label": `${node.label}. ${node.type}. ${kindLabel(node.kind)}.`,
      });
      const card = createSvg("rect", { class: "node-card", width: pos.width, height: pos.height, rx: node.isRoot ? 0 : 3 });
      const stripe = createSvg("rect", { class: "node-stripe", width: 5, height: pos.height });
      const nodeIndex = createSvg("text", { class: "node-index", x: 15, y: 18 });
      nodeIndex.textContent = node.pathIndex !== null ? String(node.pathIndex + 1).padStart(2, "0") : String(index + 1).padStart(2, "0");
      const lines = splitLabel(node.label, node.isRoot ? 27 : 24);
      const title = createSvg("text", { class: "node-title", x: 15, y: lines.length > 1 ? 30 : 41 });
      lines.forEach((line, lineIndex) => {
        const tspan = createSvg("tspan", { x: 15, dy: lineIndex === 0 ? 0 : 14 });
        tspan.textContent = line;
        title.appendChild(tspan);
      });
      const subtitle = createSvg("text", { class: "node-subtitle", x: 15, y: pos.height - 10 });
      subtitle.textContent = `${textValue(node.type, 24)} · ${kindLabel(node.kind)}`;
      group.append(card, stripe, nodeIndex, title, subtitle);
      if (node.count !== null) {
        const count = createSvg("text", { class: "node-count", x: pos.width - 12, y: 18 });
        count.textContent = formatNumber(node.count);
        group.appendChild(count);
      }
      if (this._canActivate(node)) {
        const openMark = createSvg("text", { class: "node-open-mark", x: pos.width - 11, y: pos.height - 10 });
        openMark.textContent = "↗";
        group.appendChild(openMark);
      }
      const tooltip = createSvg("title");
      tooltip.textContent = node.summary || `${node.label} · ${node.type}`;
      group.appendChild(tooltip);
      group.addEventListener("click", (event) => {
        if (this.suppressClick) {
          this.suppressClick = false;
          return;
        }
        event.stopPropagation();
        this.select(node.id);
        this.onSelect(node, this.data);
        if (this.data.viewType === "overview") this.onActivate(node, this.data);
      });
      group.addEventListener("dblclick", (event) => {
        event.preventDefault();
        if (this._canActivate(node)) this.onActivate(node, this.data);
      });
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.select(node.id);
          this.onSelect(node, this.data);
          if (this._canActivate(node)) this.onActivate(node, this.data);
        }
      });
      group.addEventListener("focus", () => {
        this.select(node.id);
        this.onSelect(node, this.data);
      });
      return group;
    }

    _canActivate(node) {
      return Boolean((this.data && this.data.viewType === "overview" && node.clusterId) || node.qualifiedName || node.caseRef);
    }

    select(nodeId) {
      this.selectedId = nodeId;
      this.camera.querySelectorAll(".atlas-node").forEach((element) => {
        const index = Array.from(element.parentNode.children).indexOf(element);
        const node = this.data.nodes[index];
        element.classList.toggle("is-selected", Boolean(node && node.id === nodeId));
      });
    }
  }

  function splitLabel(value, maxChars) {
    const text = textValue(value, 100).trim();
    if (text.length <= maxChars) return [text];
    const words = text.split(/\s+/);
    if (words.length === 1) return [`${text.slice(0, maxChars - 1)}…`];
    const lines = [""];
    words.forEach((word) => {
      const current = lines[lines.length - 1];
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxChars || !current) lines[lines.length - 1] = candidate;
      else if (lines.length < 2) lines.push(word);
    });
    if (lines.length > 1 && lines[1].length > maxChars) lines[1] = `${lines[1].slice(0, maxChars - 1)}…`;
    const joined = lines.join(" ");
    if (joined.length < text.length && lines.length > 1 && !lines[1].endsWith("…")) {
      lines[1] = `${lines[1].slice(0, Math.max(1, maxChars - 1))}…`;
    }
    return lines.slice(0, 2);
  }

  function setGraphStatus(message, kind = "ready") {
    dom.graphStatus.className = `graph-status is-${kind}`;
    dom.graphStatus.lastElementChild.textContent = message;
  }

  function setBusy(isBusy) {
    dom.app.classList.toggle("is-busy", isBusy);
    if (isBusy) setGraphStatus("Запрашиваю доказательства и строю ограниченный срез…", "loading");
  }

  function setEmpty(show, title, detail) {
    dom.graphEmpty.hidden = !show;
    if (show) {
      const strong = dom.graphEmpty.querySelector("strong");
      const paragraph = dom.graphEmpty.querySelector("p");
      strong.textContent = title || "В этом срезе нет узлов";
      paragraph.textContent = detail || "Измените запрос или вернитесь на уровень выше.";
    }
  }

  function setGraph(data, options = {}) {
    dom.graphTitle.textContent = options.title || data.title || "Атлас системы";
    dom.graphKicker.textContent = options.kicker || "СИСТЕМНЫЙ СРЕЗ";
    dom.sliceCount.textContent = formatNumber(data.nodes.length);
    dom.sliceNote.textContent = `ленивая выборка · ${data.nodes.length} из ${formatNumber(getIndexCount("nodes"))} узлов`;
    if (!data.nodes.length) {
      graph.setData(data);
      setEmpty(true, options.emptyTitle, options.emptyDetail);
      setGraphStatus(options.emptyDetail || "Нет данных для текущего среза", "ready");
      return;
    }
    setEmpty(false);
    graph.setData(data);
    const suffix = data.gaps.length ? ` · пробелов: ${data.gaps.length}` : "";
    setGraphStatus(`${data.nodes.length} узлов · ${data.edges.length} связей${suffix}`, "ready");
    renderContext(data);
  }

  function getIndexCount(kind) {
    if (!state.overview) return null;
    const index = state.overview.index || {};
    if (kind === "nodes") return firstDefined(index, ["node_count", "nodes", "total_nodes", "nodes_count"], firstDefined(state.overview.meta, ["node_count", "nodes"], null));
    return firstDefined(index, ["edge_count", "edges", "total_edges", "edges_count"], firstDefined(state.overview.meta, ["edge_count", "edges"], null));
  }

  function updateIndexReadout(overview, forcedState) {
    const index = overview ? overview.index || {} : {};
    const rawStatus = textValue(firstDefined(index, ["status", "state", "index_status"], firstDefined(overview ? overview.meta : {}, ["status", "state"], "unknown")), 80).toLowerCase();
    const stale = Boolean(firstDefined(index, ["stale", "is_stale"], false)) || forcedState === "stale";
    const error = forcedState === "error" || /error|failed|unavailable|offline/.test(rawStatus);
    const ready = !error && /ready|ok|healthy|indexed/.test(rawStatus);
    const updated = firstDefined(index, ["updated_at", "indexed_at", "generated_at", "last_updated"], "");
    dom.indexLamp.className = `state-lamp ${error ? "is-error" : stale ? "is-stale" : ready ? "is-ready" : "is-loading"}`;
    if (error) dom.indexState.textContent = "источник недоступен";
    else if (stale) dom.indexState.textContent = `устаревший срез${updated ? ` · ${formatDate(updated)}` : ""}`;
    else dom.indexState.textContent = `${rawStatus || "подключён"}${updated ? ` · ${formatDate(updated)}` : ""}`;
    dom.indexNodes.textContent = formatNumber(overview ? getIndexCount("nodes") : null);
    dom.indexEdges.textContent = formatNumber(overview ? getIndexCount("edges") : null);
  }

  function cacheOverview(payload) {
    try {
      localStorage.setItem(OVERVIEW_CACHE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), payload }));
    } catch (_error) { /* Cache is optional. */ }
  }

  function readCachedOverview() {
    try {
      const cached = JSON.parse(localStorage.getItem(OVERVIEW_CACHE_KEY) || "null");
      return cached && cached.payload ? cached : null;
    } catch (_error) {
      return null;
    }
  }

  function renderClusterList(clusters) {
    dom.clusterList.replaceChildren();
    if (!clusters.length) {
      dom.clusterList.appendChild(createElement("p", "rail-message", "Сервер не вернул список кластеров."));
      return;
    }
    clusters.forEach((cluster, index) => {
      const button = createElement("button", "rail-item");
      button.type = "button";
      const number = createElement("span", "rail-item-index", String(index + 1).padStart(2, "0"));
      const copy = createElement("span", "rail-item-copy");
      copy.append(
        createElement("strong", "", cluster.label),
        createElement("small", "", textValue(firstDefined(cluster.raw, ["packages", "package", "description"], cluster.type), 90)),
      );
      const count = createElement("span", "rail-item-count", cluster.count === null ? "↗" : formatNumber(cluster.count));
      button.append(number, copy, count);
      button.addEventListener("click", () => loadCluster(cluster.clusterId, cluster.label));
      dom.clusterList.appendChild(button);
    });
  }

  function renderResults(container, results, type) {
    container.replaceChildren();
    if (!results.length) {
      container.appendChild(createElement("p", "rail-message", "Совпадений не найдено."));
      return;
    }
    results.forEach((result, index) => {
      const button = createElement("button", "rail-item");
      button.type = "button";
      const number = createElement("span", "rail-item-index", String(index + 1).padStart(2, "0"));
      const copy = createElement("span", "rail-item-copy");
      const detail = type === "case"
        ? firstDefined(result.raw, ["service_label", "status", "client", "order_id"], result.type)
        : firstDefined(result.raw, ["qualified_name", "file_path", "module", "package"], result.type);
      copy.append(createElement("strong", "", result.label), createElement("small", "", textValue(detail, 100)));
      const open = createElement("span", "rail-item-count", "↗");
      button.append(number, copy, open);
      button.addEventListener("click", () => {
        if (type === "case") loadCaseTrace(result.caseRef || result.id, result.label);
        else loadSymbolTrace(result.qualifiedName || result.id, result.label);
      });
      container.appendChild(button);
    });
  }

  function pushView(entry, replace = false) {
    if (replace) state.stack = [entry];
    else state.stack.push(entry);
    renderBreadcrumbs();
    showStackEntry(entry);
  }

  function showStackEntry(entry) {
    state.selected = null;
    state.selectedAction = null;
    resetInspector();
    if (entry.type === "case-home") {
      const empty = {
        nodes: [], edges: [], path: [], gaps: [], timeline: [], title: "Путь лида", summary: "", meta: {}, layout: "flow", viewType: "case-home",
      };
      setGraph(empty, {
        title: "Найдите лид или заказ",
        kicker: "РАССЛЕДОВАНИЕ / ВХОД",
        emptyTitle: "Нужен точный объект расследования",
        emptyDetail: "Введите @handle, идентификатор лида или заказа слева — либо откройте встроенный пример.",
      });
      return;
    }
    setGraph(entry.data, { title: entry.title, kicker: entry.kicker });
  }

  function renderBreadcrumbs() {
    dom.breadcrumbs.replaceChildren();
    state.stack.forEach((entry, index) => {
      const button = createElement("button", "", entry.label);
      button.type = "button";
      button.dataset.crumb = String(index);
      if (index === state.stack.length - 1) button.setAttribute("aria-current", "page");
      else button.addEventListener("click", () => {
        state.stack = state.stack.slice(0, index + 1);
        renderBreadcrumbs();
        showStackEntry(state.stack[index]);
      });
      dom.breadcrumbs.appendChild(button);
    });
  }

  function resetInspector() {
    dom.evidenceCounter.textContent = "00";
    dom.evidenceKind.textContent = "ИНСПЕКТОР";
    dom.evidenceTitle.textContent = "Выберите узел";
    dom.evidenceSummary.textContent = state.lens === "case"
      ? "После выбора лида здесь появятся актор, решение, причина и источник каждого зафиксированного шага."
      : "Нажмите на категорию, чтобы открыть кластер. Выберите символ, чтобы увидеть его связи и источник.";
    dom.factGrid.replaceChildren();
    dom.evidenceAction.hidden = true;
    dom.decisionSection.hidden = true;
    dom.timeline.replaceChildren();
    dom.gapSection.hidden = true;
    dom.gapList.replaceChildren();
    dom.provenanceChip.className = "provenance-chip";
    dom.provenanceChip.textContent = "нет выбора";
    dom.provenanceNote.textContent = "Любая незафиксированная причинность помечается отдельно.";
  }

  function appendFact(label, value) {
    const text = textValue(value);
    if (!text) return;
    dom.factGrid.append(createElement("dt", "", label), createElement("dd", "", text));
  }

  function inspectNode(node, data) {
    if (!node) return resetInspector();
    state.selected = node;
    dom.evidenceCounter.textContent = String(Math.max(1, data.nodes.indexOf(node) + 1)).padStart(2, "0");
    dom.evidenceKind.textContent = textValue(node.type, 80).toUpperCase();
    dom.evidenceTitle.textContent = node.label;
    dom.evidenceSummary.textContent = node.summary || data.summary || "Для этого узла отдельное объяснение не записано.";
    dom.factGrid.replaceChildren();
    const raw = node.raw || {};
    appendFact("Тип", node.type);
    appendFact("Источник", firstDefined(raw, ["source", "source_ref", "source_file", "file_path", "module", "package"], ""));
    appendFact("Символ", node.qualifiedName);
    appendFact("Актор", firstDefined(raw, ["actor", "owner", "agent", "decided_by", "decision_owner"], ""));
    appendFact("Решение", firstDefined(raw, ["decision", "action", "result", "outcome", "status"], ""));
    appendFact("Причина", firstDefined(raw, ["reason", "reason_code", "explanation", "decision_reason", "blocker"], ""));
    appendFact("Правило", firstDefined(raw, ["policy", "rule", "selector", "routing_key", "code"], ""));
    appendFact("Цена", raw.price && typeof raw.price === "object" ? (raw.price.state === "received" ? `${formatNumber(raw.price.rub)} ₽` : "не получена") : "");
    appendFact("Оценка", raw.score !== undefined ? `${raw.score}/10` : "");
    appendFact("Время", firstDefined(raw, ["timestamp", "created_at", "event_at", "occurred_at", "updated_at", "at"], ""));
    appendFact("Узлов", node.count === null ? "" : formatNumber(node.count));
    dom.provenanceChip.className = `provenance-chip kind-${safeClass(node.kind)}`;
    dom.provenanceChip.textContent = kindLabel(node.kind);
    dom.provenanceNote.textContent = node.kind === "code_graph"
      ? "Связь найдена в исходном коде. Это не доказывает, что она выполнялась для выбранного лида."
      : node.kind === "recorded"
        ? "Шаг подтверждён сохранённым событием или структурированной записью."
        : node.kind === "policy"
          ? "Показано действующее правило выбора; факт его выполнения требует отдельной записи."
          : node.kind === "inferred"
            ? "Это вывод из доступных фактов, а не самостоятельная запись решения."
            : "Для этого перехода не хватает доказательства.";

    state.selectedAction = null;
    if (data.viewType === "overview" && node.clusterId) {
      state.selectedAction = () => loadCluster(node.clusterId, node.label);
    } else if (node.qualifiedName && !["symbol-trace", "case-trace"].includes(data.viewType)) {
      state.selectedAction = () => loadSymbolTrace(node.qualifiedName, node.label);
    } else if (node.caseRef && data.viewType === "case-results") {
      state.selectedAction = () => loadCaseTrace(node.caseRef, node.label);
    }
    dom.evidenceAction.hidden = !state.selectedAction;
  }

  function renderContext(data) {
    const timeline = data.timeline || [];
    dom.timeline.replaceChildren();
    if (timeline.length) {
      timeline.slice(0, 36).forEach((step) => {
        const item = createElement("li", `kind-${safeClass(step.kind)}`);
        const reason = firstDefined(step.raw, ["reason", "reason_code", "explanation", "status", "source"], step.type);
        item.append(createElement("strong", "", step.label), createElement("small", "", textValue(reason, 180)));
        item.addEventListener("click", () => {
          const graphNode = data.nodes.find((node) => node.id === step.id || node.label === step.label);
          if (graphNode) {
            graph.select(graphNode.id);
            inspectNode(graphNode, data);
          }
        });
        dom.timeline.appendChild(item);
      });
      dom.decisionSection.hidden = false;
    } else {
      dom.decisionSection.hidden = true;
    }

    dom.gapList.replaceChildren();
    if (data.gaps && data.gaps.length) {
      data.gaps.forEach((gap) => dom.gapList.appendChild(createElement("li", "", gap.label)));
      dom.gapSection.hidden = false;
    } else {
      dom.gapSection.hidden = true;
    }
  }

  async function loadOverview() {
    const operation = ++state.operation;
    setBusy(true);
    try {
      const payload = await fetchJson(API.overview);
      if (operation !== state.operation) return;
      const overview = normalizeOverview(payload);
      state.overview = overview;
      cacheOverview(payload);
      updateIndexReadout(overview);
      renderClusterList(overview.clusters);
      pushView({
        type: "overview",
        label: "LCBand",
        title: overview.title,
        kicker: "ОБЗОР / УРОВЕНЬ 0",
        data: overview,
      }, true);
    } catch (error) {
      if (operation !== state.operation) return;
      const cached = readCachedOverview();
      if (cached) {
        const overview = normalizeOverview(cached.payload);
        state.overview = overview;
        updateIndexReadout(overview, "stale");
        renderClusterList(overview.clusters);
        pushView({ type: "overview", label: "LCBand", title: overview.title, kicker: "ОБЗОР / КЭШ", data: overview }, true);
        setGraphStatus(`Источник недоступен. Показан сохранённый срез от ${formatDate(cached.savedAt)}.`, "error");
      } else {
        updateIndexReadout(null, "error");
        renderClusterList([]);
        const empty = { nodes: [], edges: [], path: [], gaps: [], timeline: [], title: "Архитектура недоступна", summary: "", meta: {}, layout: "flow", viewType: "overview" };
        pushView({ type: "overview", label: "LCBand", title: "Архитектура недоступна", kicker: "ОШИБКА ИСТОЧНИКА", data: empty }, true);
        setEmpty(true, "Не удалось открыть индекс", error.message);
        setGraphStatus(`Ошибка: ${error.message}`, "error");
      }
    } finally {
      if (operation === state.operation) setBusy(false);
    }
  }

  async function loadCluster(clusterId, label) {
    if (!clusterId) return;
    const operation = ++state.operation;
    setBusy(true);
    try {
      const payload = await fetchJson(API.cluster(clusterId));
      if (operation !== state.operation) return;
      const data = normalizeCluster(payload, clusterId, label);
      pushView({
        type: "cluster",
        label: label || clusterId,
        title: data.title,
        kicker: "КЛАСТЕР / УРОВЕНЬ 1",
        data,
      });
    } catch (error) {
      if (operation === state.operation) setGraphStatus(`Не удалось открыть кластер: ${error.message}`, "error");
    } finally {
      if (operation === state.operation) setBusy(false);
    }
  }

  async function searchSymbols(query) {
    const operation = ++state.operation;
    dom.symbolResults.replaceChildren(createElement("p", "rail-message", "Ищу в индексе…"));
    setBusy(true);
    try {
      const payload = await fetchJson(API.search(query));
      if (operation !== state.operation) return;
      const results = normalizeResults(payload, "symbol");
      renderResults(dom.symbolResults, results, "symbol");
      const data = resultsGraph(results, "symbol", query);
      pushView({ type: "search-results", label: `Поиск: ${query}`, title: data.title, kicker: "ИНДЕКС / РЕЗУЛЬТАТЫ", data });
    } catch (error) {
      if (operation !== state.operation) return;
      dom.symbolResults.replaceChildren(createElement("p", "rail-message is-error", error.message));
      setGraphStatus(`Ошибка поиска: ${error.message}`, "error");
    } finally {
      if (operation === state.operation) setBusy(false);
    }
  }

  async function loadSymbolTrace(symbol, label) {
    if (!symbol) return;
    const operation = ++state.operation;
    setBusy(true);
    try {
      const payload = await fetchJson(API.trace(symbol));
      if (operation !== state.operation) return;
      const data = normalizeGraph(payload, { layout: "flow", viewType: "symbol-trace", title: label || symbol });
      data.title = data.title || label || symbol;
      pushView({ type: "symbol-trace", label: label || symbol, title: data.title, kicker: "СИМВОЛ / ВХОДЫ И ВЫХОДЫ", data });
    } catch (error) {
      if (operation === state.operation) setGraphStatus(`Не удалось построить трассу символа: ${error.message}`, "error");
    } finally {
      if (operation === state.operation) setBusy(false);
    }
  }

  async function searchCases(query) {
    const operation = ++state.operation;
    dom.caseResults.replaceChildren(createElement("p", "rail-message", "Ищу точные совпадения…"));
    setBusy(true);
    try {
      const payload = await fetchJson(API.casesSearch(query));
      if (operation !== state.operation) return;
      const results = normalizeResults(payload, "case");
      renderResults(dom.caseResults, results, "case");
      const data = resultsGraph(results, "case", query);
      pushView({ type: "case-results", label: `Поиск: ${query}`, title: data.title, kicker: "РАССЛЕДОВАНИЕ / КАНДИДАТЫ", data });
    } catch (error) {
      if (operation !== state.operation) return;
      dom.caseResults.replaceChildren(createElement("p", "rail-message is-error", error.message));
      setGraphStatus(`Ошибка поиска: ${error.message}`, "error");
    } finally {
      if (operation === state.operation) setBusy(false);
    }
  }

  async function loadCaseTrace(ref, label) {
    if (!ref) return;
    const operation = ++state.operation;
    if (state.lens !== "case") setLens("case", false);
    setBusy(true);
    try {
      const payload = await fetchJson(API.caseTrace(ref));
      if (operation !== state.operation) return;
      const data = normalizeGraph(payload, { layout: "timeline", viewType: "case-trace", caseMode: true, fallbackKind: "recorded", title: label || ref });
      data.title = data.title || label || ref;
      pushView({ type: "case-trace", label: label || ref, title: data.title, kicker: "ПУТЬ ЛИДА / ДОКАЗАТЕЛЬСТВА", data });
      if (data.nodes.length) inspectNode(data.nodes[0], data);
    } catch (error) {
      if (operation === state.operation) {
        setGraphStatus(`Не удалось восстановить путь: ${error.message}`, "error");
        setEmpty(true, "Путь не построен", error.message);
      }
    } finally {
      if (operation === state.operation) setBusy(false);
    }
  }

  function setLens(lens, resetView = true) {
    state.lens = lens;
    const architecture = lens === "architecture";
    dom.lensArchitecture.classList.toggle("is-active", architecture);
    dom.lensArchitecture.setAttribute("aria-pressed", String(architecture));
    dom.lensCase.classList.toggle("is-active", !architecture);
    dom.lensCase.setAttribute("aria-pressed", String(!architecture));
    dom.architectureControls.hidden = !architecture;
    dom.caseControls.hidden = architecture;
    dom.disclaimer.textContent = architecture
      ? "Сейчас показаны отношения в индексированном исходном коде, а не живой runtime-trace."
      : "Подсветка означает восстановленный путь по данным. Выводы и отсутствующие записи отмечаются отдельно.";
    resetInspector();
    if (!resetView) return;
    state.operation += 1;
    if (architecture) {
      if (state.overview) {
        renderClusterList(state.overview.clusters);
        pushView({ type: "overview", label: "LCBand", title: state.overview.title, kicker: "ОБЗОР / УРОВЕНЬ 0", data: state.overview }, true);
      } else {
        loadOverview();
      }
    } else {
      pushView({ type: "case-home", label: "Путь лида", title: "Найдите лид или заказ", kicker: "РАССЛЕДОВАНИЕ / ВХОД", data: null }, true);
    }
  }

  function activateNode(node, data) {
    if (!node) return;
    if (data.viewType === "overview" && node.clusterId) loadCluster(node.clusterId, node.label);
    else if (node.caseRef) loadCaseTrace(node.caseRef, node.label);
    else if (node.qualifiedName) loadSymbolTrace(node.qualifiedName, node.label);
  }

  function collectDom() {
    dom.app = byId("atlas-app");
    dom.indexLamp = byId("index-lamp");
    dom.indexState = byId("index-state");
    dom.indexNodes = byId("index-nodes");
    dom.indexEdges = byId("index-edges");
    dom.sliceCount = byId("slice-count");
    dom.lensArchitecture = byId("lens-architecture");
    dom.lensCase = byId("lens-case");
    dom.disclaimer = byId("view-disclaimer");
    dom.breadcrumbs = byId("breadcrumbs");
    dom.architectureControls = byId("architecture-controls");
    dom.caseControls = byId("case-controls");
    dom.clusterList = byId("cluster-list");
    dom.symbolResults = byId("symbol-results");
    dom.caseResults = byId("case-results");
    dom.graphTitle = byId("graph-title");
    dom.graphKicker = byId("graph-kicker");
    dom.graphStatus = byId("graph-status");
    dom.graphEmpty = byId("graph-empty");
    dom.sliceNote = byId("slice-note");
    dom.zoomReset = byId("zoom-reset");
    dom.evidenceCounter = byId("evidence-counter");
    dom.evidenceKind = byId("evidence-kind");
    dom.evidenceTitle = byId("evidence-title");
    dom.evidenceSummary = byId("evidence-summary");
    dom.factGrid = byId("fact-grid");
    dom.evidenceAction = byId("evidence-action");
    dom.decisionSection = byId("decision-section");
    dom.timeline = byId("decision-timeline");
    dom.gapSection = byId("gap-section");
    dom.gapList = byId("gap-list");
    dom.provenanceChip = byId("provenance-chip");
    dom.provenanceNote = byId("provenance-note");
  }

  let graph;

  function wireEvents() {
    dom.lensArchitecture.addEventListener("click", () => setLens("architecture"));
    dom.lensCase.addEventListener("click", () => setLens("case"));
    byId("symbol-search-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const query = byId("symbol-search").value.trim();
      if (query.length >= 2) searchSymbols(query);
    });
    byId("case-search-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const query = byId("case-search").value.trim();
      if (query.length >= 2) searchCases(query);
    });
    byId("example-case").addEventListener("click", () => loadCaseTrace("broker:99eeb75f6a", "Баян / аккордеон · 99eeb75f6a"));
    byId("open-selected").addEventListener("click", () => {
      if (state.selectedAction) state.selectedAction();
    });
    byId("zoom-in").addEventListener("click", () => graph.zoomBy(1.2));
    byId("zoom-out").addEventListener("click", () => graph.zoomBy(1 / 1.2));
    byId("zoom-reset").addEventListener("click", () => graph.reset());
    byId("zoom-fit").addEventListener("click", () => graph.fit());
  }

  function init() {
    collectDom();
    graph = new GraphRenderer(byId("atlas-svg"), byId("graph-camera"), byId("graph-viewport"));
    graph.onSelect = inspectNode;
    graph.onActivate = activateNode;
    wireEvents();
    resetInspector();
    loadOverview();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}());
