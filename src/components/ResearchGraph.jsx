import { useRef, useEffect, useCallback, useState } from 'react';
import * as d3 from 'd3';
import { explainContradiction as apiExplainContradiction } from '../services/api';

const RELATIONSHIP_COLORS = {
  shared_concept: '#3b82f6',
  contradiction: '#f59e0b',
  methodology: '#a78bfa',
};

function getNodeColor(year) {
  const currentYear = new Date().getFullYear();
  const age = currentYear - (year || 0);
  if (age <= 2) return '#34d399';
  if (age <= 5) return '#60a5fa';
  return '#94a3b8';
}

const EVIDENCE_COLORS = {
  1: '#22c55e', 2: '#3b82f6', 3: '#8b5cf6', 4: '#f59e0b', 5: '#ef4444', 6: '#94a3b8',
};

export default function ResearchGraph({ papers, relationships, summaries, evidence, onSelectPaper, onOpenFullPaper, selectedPaperId, onCitationChain, isBookmarked, onToggleBookmark }) {
  const svgRef = useRef(null);
  const simulationRef = useRef(null);
  const [previewPanel, setPreviewPanel] = useState(null);
  const builtRef = useRef(false);
  const [timelineMode, setTimelineMode] = useState(false);
  const [conflictMode, setConflictMode] = useState(false);
  const [conflictExplanations, setConflictExplanations] = useState({});
  const [loadingExplanations, setLoadingExplanations] = useState({});

  // Refs to keep D3 selections accessible for mode toggling
  const graphDataRef = useRef({ nodes: [], links: [], nodeSelection: null, linkSelection: null, svg: null, g: null, zoom: null, width: 0, height: 0 });

  // Use refs to avoid dependency loop in fetchContradictionExplanation
  const explanationsRef = useRef(conflictExplanations);
  const loadingRef = useRef(loadingExplanations);
  explanationsRef.current = conflictExplanations;
  loadingRef.current = loadingExplanations;

  const fetchContradictionExplanation = useCallback(async (paper1Id, paper2Id) => {
    const key = `${paper1Id}__${paper2Id}`;
    if (explanationsRef.current[key] || loadingRef.current[key]) return;
    setLoadingExplanations((prev) => ({ ...prev, [key]: true }));
    try {
      const data = await apiExplainContradiction(
        papers.find((p) => p.paperId === paper1Id),
        papers.find((p) => p.paperId === paper2Id),
      );
      setConflictExplanations((prev) => ({ ...prev, [key]: data.explanation || 'No explanation available.' }));
    } catch {
      setConflictExplanations((prev) => ({ ...prev, [key]: 'Failed to load explanation.' }));
    } finally {
      setLoadingExplanations((prev) => ({ ...prev, [key]: false }));
    }
  }, [papers]);

  const buildGraph = useCallback(() => {
    if (!papers.length || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const contradictionPapers = new Set();
    const contradictionPairs = [];
    relationships.forEach((r) => {
      if (r.type === 'contradiction') {
        contradictionPapers.add(r.paper1_id);
        contradictionPapers.add(r.paper2_id);
        contradictionPairs.push({ paper1_id: r.paper1_id, paper2_id: r.paper2_id, reason: r.reason });
      }
    });

    const years = papers.map((p) => p.year || new Date().getFullYear());
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const sizeScale = d3.scaleLinear().domain([minYear, maxYear]).range([14, 40]);

    const nodes = papers.map((p, i) => ({
      id: p.paperId,
      title: p.title,
      year: p.year,
      citations: p.citationCount || 0,
      radius: sizeScale(p.year || new Date().getFullYear()),
      color: getNodeColor(p.year),
      hasContradiction: contradictionPapers.has(p.paperId),
      // Start clustered at center for burst animation
      x: width / 2 + (Math.random() - 0.5) * 30,
      y: height / 2 + (Math.random() - 0.5) * 30,
      index: i,
    }));

    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = relationships
      .filter((r) => nodeIds.has(r.paper1_id) && nodeIds.has(r.paper2_id))
      .map((r) => ({
        source: r.paper1_id,
        target: r.paper2_id,
        type: r.type,
        strength: r.strength || 0.5,
        reason: r.reason,
      }));

    // ---- SVG defs ----
    const defs = svg.append('defs');

    // Node glow filter
    const glow = defs.append('filter').attr('id', 'node-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    glow.append('feGaussianBlur').attr('stdDeviation', '8').attr('result', 'blur');
    const merge = glow.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Selected glow filter
    const selGlow = defs.append('filter').attr('id', 'selected-glow').attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%');
    selGlow.append('feGaussianBlur').attr('stdDeviation', '10').attr('result', 'blur');
    const selMerge = selGlow.append('feMerge');
    selMerge.append('feMergeNode').attr('in', 'blur');
    selMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Ripple filter for hover
    const ripple = defs.append('filter').attr('id', 'ripple-glow').attr('x', '-100%').attr('y', '-100%').attr('width', '300%').attr('height', '300%');
    ripple.append('feGaussianBlur').attr('stdDeviation', '12').attr('result', 'blur');
    const ripMerge = ripple.append('feMerge');
    ripMerge.append('feMergeNode').attr('in', 'blur');
    ripMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Animated dash pattern for contradiction edges
    const style = defs.append('style');
    style.text(`
      @keyframes dash-travel {
        to { stroke-dashoffset: -40; }
      }
      .contradiction-edge {
        animation: dash-travel 2.5s linear infinite;
      }
      @keyframes ripple-expand {
        0% { r: 0; opacity: 0.5; }
        100% { r: 60; opacity: 0; }
      }
    `);

    const g = svg.append('g');
    const zoom = d3.zoom().scaleExtent([0.2, 5]).on('zoom', (event) => {
      g.attr('transform', event.transform);
    });
    svg.call(zoom);

    // ---- Links ----
    const linkGroup = g.append('g').attr('class', 'links');
    const link = linkGroup.selectAll('line').data(links).join('line')
      .attr('stroke', (d) => RELATIONSHIP_COLORS[d.type] || '#64748b')
      .attr('stroke-opacity', (d) => 0.5 + d.strength * 0.4)
      .attr('stroke-width', (d) => 1.5 + d.strength * 3)
      .attr('stroke-dasharray', (d) => (d.type === 'contradiction' ? '8,5' : 'none'))
      .attr('class', (d) => d.type === 'contradiction' ? 'contradiction-edge' : '')
      .attr('data-type', (d) => d.type);

    // ---- Nodes ----
    const node = g.append('g').selectAll('g').data(nodes).join('g')
      .attr('cursor', 'grab')
      .attr('class', 'node-pulse')
      .attr('data-has-contradiction', (d) => d.hasContradiction ? 'true' : 'false')
      .call(
        d3.drag()
          .on('start', (event, d) => {
            if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0.1).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on('end', (event, d) => {
            if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0);
            // Keep node fixed where it was dragged
            d.fx = event.x; d.fy = event.y;
          })
      )
      .on('click', (event, d) => {
        event.stopPropagation();
        const paper = papers.find((p) => p.paperId === d.id);
        if (paper) {
          onSelectPaper(paper);
          // Try exact key first, then partial match, then abstract fallback
          let summary = summaries?.[paper.paperId] || null;
          if (!summary && summaries) {
            const key = Object.keys(summaries).find((k) => k === paper.paperId || paper.paperId.includes(k) || k.includes(paper.paperId));
            if (key) summary = summaries[key];
          }
          if (!summary && paper.abstract) {
            summary = paper.abstract.slice(0, 400) + (paper.abstract.length > 400 ? '...' : '');
          }
          setPreviewPanel({ paper, summary });
        }
      })
      .on('mouseenter', function (event, d) {
        const self = d3.select(this);

        // Ripple effect
        const rippleCircle = self.append('circle')
          .attr('class', 'ripple-ring')
          .attr('r', 0)
          .attr('fill', 'none')
          .attr('stroke', d.color)
          .attr('stroke-width', 2)
          .attr('opacity', 0.6);

        rippleCircle.transition()
          .duration(600)
          .attr('r', d.radius + 40)
          .attr('opacity', 0)
          .remove();

        // Highlight connected edges
        const connectedNodeIds = new Set();
        connectedNodeIds.add(d.id);
        link.each(function (l) {
          const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
          const targetId = typeof l.target === 'object' ? l.target.id : l.target;
          if (sourceId === d.id || targetId === d.id) {
            connectedNodeIds.add(sourceId);
            connectedNodeIds.add(targetId);
            d3.select(this)
              .attr('stroke-opacity', 1)
              .attr('stroke-width', (l) => 2.5 + l.strength * 4);
          }
        });

        // Dim unconnected nodes
        node.filter((n) => !connectedNodeIds.has(n.id))
          .transition().duration(200)
          .attr('opacity', 0.3);
      })
      .on('mouseleave', function () {
        d3.select(this).selectAll('.ripple-ring').remove();

        // Restore edges
        link.attr('stroke-opacity', (d) => 0.5 + d.strength * 0.4)
          .attr('stroke-width', (d) => 1.5 + d.strength * 3);

        // Restore nodes
        node.transition().duration(200).attr('opacity', 1);
      });

    svg.on('click', () => setPreviewPanel(null));

    // Contradiction ring
    node.filter((d) => d.hasContradiction)
      .append('circle')
      .attr('r', (d) => d.radius + 8)
      .attr('fill', 'none')
      .attr('stroke', '#f59e0b')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '5,4')
      .attr('opacity', 0.6);

    // Main circle (single clean circle with subtle glow)
    node.append('circle')
      .attr('class', 'main-circle')
      .attr('r', (d) => d.radius)
      .attr('fill', (d) => d.color)
      .attr('fill-opacity', 0.9)
      .attr('stroke', 'rgba(255,255,255,0.15)')
      .attr('stroke-width', 1)
      .style('filter', 'url(#node-glow)');

    // Label
    node.append('text')
      .text((d) => d.title.length > 22 ? d.title.slice(0, 20) + '...' : d.title)
      .attr('dy', (d) => d.radius + 16)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(255,255,255,0.55)')
      .attr('font-size', '9px')
      .attr('font-family', 'IBM Plex Sans, system-ui, sans-serif')
      .attr('pointer-events', 'none');

    // Year inside node
    node.append('text')
      .text((d) => d.year || '')
      .attr('dy', 4)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(255,255,255,0.85)')
      .attr('font-size', '10px')
      .attr('font-weight', '700')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('pointer-events', 'none');

    node.append('title').text((d) => `${d.title}\n${d.year} \u00b7 ${d.citations} citations`);

    // Store refs for mode toggling
    graphDataRef.current = { nodes, links, nodeSelection: node, linkSelection: link, svg, g, zoom, width, height, contradictionPairs };

    // ---- Force simulation — burst from center, then freeze ----
    simulationRef.current = d3
      .forceSimulation(nodes)
      .alpha(1)
      .alphaDecay(0.05) // fast decay so nodes settle quickly
      .alphaMin(0.01) // stop early
      .velocityDecay(0.4) // dampen movement
      .force('link', d3.forceLink(links).id((d) => d.id).distance(160).strength((d) => d.strength * 0.3))
      .force('charge', d3.forceManyBody().strength(-350))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d) => d.radius + 20))
      .on('tick', () => {
        link.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
          .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
        node.attr('transform', (d) => `translate(${d.x},${d.y})`);
      });

    // Staggered entrance: nodes start invisible, fade in with stagger
    node.attr('opacity', 0);
    node.each(function (d, i) {
      d3.select(this)
        .transition()
        .delay(i * 60)
        .duration(400)
        .attr('opacity', 1);
    });

    link.attr('stroke-opacity', 0);
    link.transition().delay(300).duration(600)
      .attr('stroke-opacity', (d) => 0.5 + d.strength * 0.4);

    simulationRef.current.on('end', () => {
      // Fix all nodes in place so they stop moving
      nodes.forEach((n) => { n.fx = n.x; n.fy = n.y; });
      if (builtRef.current) return;
      builtRef.current = true;
      const allX = nodes.map((n) => n.x);
      const allY = nodes.map((n) => n.y);
      const pad = 80;
      const minX = Math.min(...allX) - pad;
      const maxX = Math.max(...allX) + pad;
      const minY = Math.min(...allY) - pad;
      const maxY = Math.max(...allY) + pad;
      const graphWidth = maxX - minX;
      const graphHeight = maxY - minY;
      const scale = Math.min(width / graphWidth, height / graphHeight, 1.2) * 0.85;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const transform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-centerX, -centerY);
      svg.transition().duration(800).call(zoom.transform, transform);
    });
  }, [papers, relationships, summaries, onSelectPaper]);

  // ---- Apply timeline mode ----
  useEffect(() => {
    const { nodes, links, nodeSelection, linkSelection, svg, g, width, height, zoom } = graphDataRef.current;
    if (!nodes.length || !simulationRef.current || !nodeSelection) return;

    if (timelineMode) {
      const years = nodes.map((n) => n.year).filter(Boolean);
      const minYear = Math.min(...years);
      const maxYear = Math.max(...years);
      const yearScale = d3.scaleLinear().domain([minYear, maxYear]).range([120, width - 120]);

      // Stop current simulation, reconfigure forces
      simulationRef.current.stop();
      simulationRef.current
        .force('center', null)
        .force('charge', d3.forceManyBody().strength(-100))
        .force('x', d3.forceX((d) => yearScale(d.year || minYear)).strength(1.2))
        .force('y', d3.forceY(height / 2 - 30).strength(0.15))
        .force('collision', d3.forceCollide().radius((d) => d.radius + 12))
        .alpha(0.8)
        .restart();

      // Draw year axis
      g.selectAll('.timeline-axis').remove();
      const axisGroup = g.append('g').attr('class', 'timeline-axis')
        .attr('transform', `translate(0, ${height - 60})`);

      const uniqueYears = [...new Set(years)].sort();
      uniqueYears.forEach((yr) => {
        axisGroup.append('line')
          .attr('x1', yearScale(yr))
          .attr('x2', yearScale(yr))
          .attr('y1', 0)
          .attr('y2', -height + 100)
          .attr('stroke', 'rgba(255,255,255,0.06)')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '4,6');

        axisGroup.append('text')
          .text(yr)
          .attr('x', yearScale(yr))
          .attr('y', 20)
          .attr('text-anchor', 'middle')
          .attr('fill', 'rgba(255,255,255,0.5)')
          .attr('font-size', '11px')
          .attr('font-family', 'IBM Plex Mono, monospace')
          .attr('font-weight', '600');
      });

      // Axis line
      axisGroup.append('line')
        .attr('x1', yearScale(minYear) - 20)
        .attr('x2', yearScale(maxYear) + 20)
        .attr('y1', 0)
        .attr('y2', 0)
        .attr('stroke', 'rgba(255,255,255,0.15)')
        .attr('stroke-width', 1);
    } else {
      // Restore force layout
      g.selectAll('.timeline-axis').remove();
      simulationRef.current.stop();
      simulationRef.current
        .force('x', null)
        .force('y', null)
        .force('charge', d3.forceManyBody().strength(-350))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius((d) => d.radius + 20))
        .alpha(0.8)
        .restart();
    }
  }, [timelineMode]);

  // ---- Apply conflict mode visual changes ----
  useEffect(() => {
    const { nodes, links, nodeSelection, linkSelection, contradictionPairs } = graphDataRef.current;
    if (!nodeSelection || !linkSelection) return;

    if (conflictMode) {
      // Dim non-contradiction edges
      linkSelection.transition().duration(400)
        .attr('stroke-opacity', (d) => d.type === 'contradiction' ? 0.9 : 0.05)
        .attr('stroke-width', (d) => d.type === 'contradiction' ? 3 + d.strength * 3 : 1);

      // Dim non-contradiction nodes
      const contradictionNodeIds = new Set();
      links.forEach((l) => {
        if (l.type === 'contradiction') {
          const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
          const targetId = typeof l.target === 'object' ? l.target.id : l.target;
          contradictionNodeIds.add(sourceId);
          contradictionNodeIds.add(targetId);
        }
      });

      nodeSelection.transition().duration(400)
        .attr('opacity', (d) => contradictionNodeIds.has(d.id) ? 1 : 0.3);

      // Fetch explanations for contradiction pairs
      if (contradictionPairs) {
        contradictionPairs.forEach((pair) => {
          fetchContradictionExplanation(pair.paper1_id, pair.paper2_id);
        });
      }
    } else {
      // Restore everything
      linkSelection.transition().duration(400)
        .attr('stroke-opacity', (d) => 0.5 + d.strength * 0.4)
        .attr('stroke-width', (d) => 1.5 + d.strength * 3);

      nodeSelection.transition().duration(400)
        .attr('opacity', 1);
    }
  }, [conflictMode, fetchContradictionExplanation]);

  useEffect(() => {
    setPreviewPanel(null);
    builtRef.current = false;
    buildGraph();
    return () => { if (simulationRef.current) simulationRef.current.stop(); };
  }, [buildGraph]);

  // Build conflict pairs list for the side panel
  const contradictionPairsForPanel = relationships
    .filter((r) => r.type === 'contradiction')
    .map((r) => {
      const p1 = papers.find((p) => p.paperId === r.paper1_id);
      const p2 = papers.find((p) => p.paperId === r.paper2_id);
      const key = `${r.paper1_id}__${r.paper2_id}`;
      return { paper1: p1, paper2: p2, reason: r.reason, key, explanation: conflictExplanations[key], loading: loadingExplanations[key] };
    })
    .filter((c) => c.paper1 && c.paper2);

  return (
    <div className="research-graph">
      <div className="graph-top-bar">
        <div className="graph-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <span>KNOWLEDGE GRAPH</span>
        </div>
        <div className="graph-controls-row">
          <div className="graph-legend">
            <span className="legend-item"><span className="legend-dot" style={{ background: '#34d399' }} /> Recent</span>
            <span className="legend-item"><span className="legend-dot" style={{ background: '#60a5fa' }} /> 3-5yr</span>
            <span className="legend-item"><span className="legend-dot" style={{ background: '#94a3b8' }} /> Older</span>
            <span className="legend-item"><span className="legend-line dashed amber" /> Contradiction</span>
          </div>
          <div className="graph-mode-buttons">
            <button
              className={`btn btn-sm graph-mode-btn ${timelineMode ? 'active' : ''}`}
              onClick={() => setTimelineMode((v) => !v)}
              style={{
                background: timelineMode ? 'var(--accent-subtle, rgba(59,130,246,0.15))' : 'transparent',
                borderColor: timelineMode ? 'var(--accent, #3b82f6)' : 'var(--border, #334155)',
                color: timelineMode ? 'var(--text-accent, #60a5fa)' : 'var(--text-secondary, #94a3b8)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <circle cx="6" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="18" cy="12" r="2" />
              </svg>
              Timeline
            </button>
            <button
              className={`btn btn-sm graph-mode-btn ${conflictMode ? 'active' : ''}`}
              onClick={() => setConflictMode((v) => !v)}
              style={{
                background: conflictMode ? 'rgba(245,158,11,0.15)' : 'transparent',
                borderColor: conflictMode ? '#f59e0b' : 'var(--border, #334155)',
                color: conflictMode ? '#f59e0b' : 'var(--text-secondary, #94a3b8)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Conflict Mode
            </button>
          </div>
        </div>
      </div>

      <div className={`graph-canvas-wrap ${previewPanel ? 'panel-open' : ''} ${conflictMode ? 'conflict-panel-open' : ''}`}>
        <svg ref={svgRef} />

        {/* Conflict mode side panel */}
        {conflictMode && contradictionPairsForPanel.length > 0 && (
          <div className="conflict-side-panel" style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 340,
            height: '100%',
            background: 'var(--bg-surface, #0f172a)',
            borderLeft: '1px solid var(--border, #1e293b)',
            overflowY: 'auto',
            padding: '16px',
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{
                fontSize: 10,
                fontFamily: 'IBM Plex Mono, monospace',
                letterSpacing: 2,
                color: '#f59e0b',
                fontWeight: 700,
              }}>
                CONTRADICTIONS ({contradictionPairsForPanel.length})
              </div>
              <button
                onClick={() => setConflictMode(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary, #94a3b8)',
                  cursor: 'pointer',
                  fontSize: 18,
                  lineHeight: 1,
                  padding: '2px 6px',
                }}
              >
                &times;
              </button>
            </div>

            {contradictionPairsForPanel.map((c) => (
              <div key={c.key} className="conflict-card" style={{
                background: 'rgba(245,158,11,0.06)',
                border: '1px solid rgba(245,158,11,0.15)',
                borderRadius: 8,
                padding: 14,
              }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <div style={{
                    flex: 1,
                    fontSize: 11,
                    color: 'var(--text-primary, #e2e8f0)',
                    lineHeight: 1.4,
                    fontWeight: 600,
                  }}>
                    {c.paper1.title.length > 60 ? c.paper1.title.slice(0, 58) + '...' : c.paper1.title}
                  </div>
                  <div style={{
                    color: '#f59e0b',
                    fontSize: 14,
                    fontWeight: 700,
                    flexShrink: 0,
                    alignSelf: 'center',
                  }}>
                    vs
                  </div>
                  <div style={{
                    flex: 1,
                    fontSize: 11,
                    color: 'var(--text-primary, #e2e8f0)',
                    lineHeight: 1.4,
                    fontWeight: 600,
                  }}>
                    {c.paper2.title.length > 60 ? c.paper2.title.slice(0, 58) + '...' : c.paper2.title}
                  </div>
                </div>

                {c.reason && (
                  <div style={{
                    fontSize: 10,
                    color: 'var(--text-secondary, #94a3b8)',
                    marginBottom: 8,
                    fontStyle: 'italic',
                  }}>
                    {c.reason}
                  </div>
                )}

                <div style={{
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                  paddingTop: 10,
                  marginTop: 4,
                }}>
                  <div style={{
                    fontSize: 9,
                    fontFamily: 'IBM Plex Mono, monospace',
                    letterSpacing: 1.5,
                    color: 'rgba(255,255,255,0.35)',
                    marginBottom: 6,
                  }}>
                    AI ANALYSIS
                  </div>
                  {c.loading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', width: '100%' }} />
                      <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', width: '85%' }} />
                      <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', width: '60%' }} />
                    </div>
                  ) : c.explanation ? (
                    <p style={{
                      fontSize: 11,
                      color: 'var(--text-secondary, #94a3b8)',
                      lineHeight: 1.65,
                      margin: 0,
                    }}>
                      {c.explanation}
                    </p>
                  ) : (
                    <p style={{
                      fontSize: 11,
                      color: 'rgba(255,255,255,0.25)',
                      margin: 0,
                      fontStyle: 'italic',
                    }}>
                      Waiting for analysis...
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Slide-in preview panel */}
        {previewPanel && (() => {
          const ev = evidence?.[previewPanel.paper.paperId];
          const bookmarked = isBookmarked?.(previewPanel.paper.paperId);
          return (
            <div className="graph-preview-panel">
              <div className="preview-header">
                <div className="preview-label">PAPER PREVIEW</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleBookmark?.(previewPanel.paper); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: bookmarked ? '#f59e0b' : 'var(--text-muted)', padding: '2px' }}
                    title={bookmarked ? 'Remove bookmark' : 'Bookmark'}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                  </button>
                  <button className="preview-close" onClick={() => setPreviewPanel(null)}>&times;</button>
                </div>
              </div>

              <div className="preview-badges">
                <span className="preview-badge year">{previewPanel.paper.year}</span>
                <span className="preview-badge citations">{previewPanel.paper.citationCount || 0} citations</span>
              </div>

              <h4 className="preview-title">{previewPanel.paper.title}</h4>

              <p className="preview-authors">
                {previewPanel.paper.authors?.slice(0, 3).map((a) => a.name).join(', ')}
                {previewPanel.paper.authors?.length > 3 ? ' et al.' : ''}
              </p>

              {/* Evidence Strength Meter */}
              {ev && (
                <div className="evidence-meter" style={{ margin: '10px 0' }}>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono, monospace)', letterSpacing: 1.5, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>EVIDENCE STRENGTH</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="evidence-bar">
                      {[1, 2, 3, 4, 5, 6].map((lvl) => (
                        <div
                          key={lvl}
                          className="evidence-bar-segment"
                          style={{
                            background: lvl <= (7 - ev.level) ? (EVIDENCE_COLORS[ev.level] || '#94a3b8') : 'rgba(255,255,255,0.06)',
                          }}
                        />
                      ))}
                    </div>
                    <span style={{ fontSize: 11, color: EVIDENCE_COLORS[ev.level] || '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {ev.type}
                    </span>
                  </div>
                  {ev.reason && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>{ev.reason}</div>
                  )}
                </div>
              )}

              <hr className="preview-divider" />

              <div>
                <div className="preview-summary-label">AI SUMMARY</div>
                {previewPanel.summary ? (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>
                    {previewPanel.summary.split('\n').filter(Boolean).map((paragraph, idx) => (
                      <p key={idx} style={{ margin: '0 0 8px 0' }}>
                        {paragraph.replace(/[-\u2022]\s*/g, '')}
                      </p>
                    ))}
                  </div>
                ) : (
                  [1, 2, 3].map((i) => (
                    <div key={i} className="preview-skeleton" style={{ width: i === 3 ? '60%' : '100%' }} />
                  ))
                )}
              </div>

              <div style={{ flex: 1 }} />

              <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                <button
                  className="btn btn-primary preview-open-btn"
                  style={{ width: '100%', justifyContent: 'center', borderRadius: 8, padding: '10px 0', fontSize: 12, letterSpacing: 1 }}
                  onClick={() => {
                    onOpenFullPaper(previewPanel.paper);
                    setPreviewPanel(null);
                  }}
                >
                  OPEN FULL PAPER &rarr;
                </button>
                <button
                  className="btn preview-open-btn"
                  style={{ width: '100%', justifyContent: 'center', borderRadius: 8, padding: '8px 0', fontSize: 11, letterSpacing: 1 }}
                  onClick={() => {
                    onCitationChain?.(previewPanel.paper);
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  CITATION CHAIN
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
