import { useRef, useEffect, useCallback, useState } from 'react';
import * as d3 from 'd3';

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

export default function ResearchGraph({ papers, relationships, summaries, onSelectPaper, onOpenFullPaper, selectedPaperId }) {
  const svgRef = useRef(null);
  const simulationRef = useRef(null);
  const [previewPanel, setPreviewPanel] = useState(null);
  const builtRef = useRef(false); // prevent re-building on selectedPaper change

  const buildGraph = useCallback(() => {
    if (!papers.length || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const contradictionPapers = new Set();
    relationships.forEach((r) => {
      if (r.type === 'contradiction') {
        contradictionPapers.add(r.paper1_id);
        contradictionPapers.add(r.paper2_id);
      }
    });

    const maxCitations = Math.max(...papers.map((p) => p.citationCount || 1));
    const sizeScale = d3.scaleSqrt().domain([0, maxCitations]).range([14, 40]);

    const nodes = papers.map((p) => ({
      id: p.paperId,
      title: p.title,
      year: p.year,
      citations: p.citationCount || 0,
      radius: sizeScale(p.citationCount || 0),
      color: getNodeColor(p.year),
      hasContradiction: contradictionPapers.has(p.paperId),
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

    const defs = svg.append('defs');
    const glow = defs.append('filter').attr('id', 'node-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    glow.append('feGaussianBlur').attr('stdDeviation', '6').attr('result', 'blur');
    const merge = glow.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    const selGlow = defs.append('filter').attr('id', 'selected-glow').attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%');
    selGlow.append('feGaussianBlur').attr('stdDeviation', '10').attr('result', 'blur');
    const selMerge = selGlow.append('feMerge');
    selMerge.append('feMergeNode').attr('in', 'blur');
    selMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    const g = svg.append('g');
    const zoom = d3.zoom().scaleExtent([0.2, 5]).on('zoom', (event) => {
      g.attr('transform', event.transform);
    });
    svg.call(zoom);

    // Links
    const link = g.append('g').attr('class', 'links').selectAll('line').data(links).join('line')
      .attr('stroke', (d) => RELATIONSHIP_COLORS[d.type] || '#64748b')
      .attr('stroke-opacity', (d) => 0.5 + d.strength * 0.4)
      .attr('stroke-width', (d) => 1.5 + d.strength * 3)
      .attr('stroke-dasharray', (d) => (d.type === 'contradiction' ? '8,5' : 'none'));

    // Nodes
    const node = g.append('g').selectAll('g').data(nodes).join('g')
      .attr('cursor', 'grab')
      .call(
        d3.drag()
          .on('start', (event, d) => {
            if (!event.active) simulationRef.current.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on('end', (event, d) => {
            if (!event.active) simulationRef.current.alphaTarget(0);
            d.fx = null; d.fy = null;
          })
      )
      .on('click', (event, d) => {
        event.stopPropagation();
        const paper = papers.find((p) => p.paperId === d.id);
        if (paper) {
          onSelectPaper(paper);
          setPreviewPanel({
            paper,
            summary: summaries?.[paper.paperId] || null,
          });
        }
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

    // Outer glow
    node.append('circle')
      .attr('r', (d) => d.radius + 4)
      .attr('fill', (d) => d.color)
      .attr('fill-opacity', 0.12)
      .style('filter', 'url(#node-glow)');

    // Main circle
    node.append('circle')
      .attr('r', (d) => d.radius)
      .attr('fill', (d) => d.color)
      .attr('fill-opacity', 0.9)
      .attr('stroke', 'rgba(255,255,255,0.15)')
      .attr('stroke-width', 1);

    // Inner highlight
    node.append('circle')
      .attr('r', (d) => d.radius * 0.5)
      .attr('fill', 'rgba(255,255,255,0.12)')
      .attr('pointer-events', 'none');

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

    node.append('title').text((d) => `${d.title}\n${d.year} · ${d.citations} citations`);

    simulationRef.current = d3
      .forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id).distance(160).strength((d) => d.strength * 0.3))
      .force('charge', d3.forceManyBody().strength(-350))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d) => d.radius + 20))
      .on('tick', () => {
        link.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
          .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
        node.attr('transform', (d) => `translate(${d.x},${d.y})`);
      });

    simulationRef.current.on('end', () => {
      // Only zoom-to-fit once on initial graph build
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

  useEffect(() => {
    // Only rebuild graph when papers/relationships change, not on selectedPaper change
    setPreviewPanel(null);
    builtRef.current = false;
    buildGraph();
    return () => { if (simulationRef.current) simulationRef.current.stop(); };
  }, [buildGraph]);

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
        <div className="graph-legend">
          <span className="legend-item"><span className="legend-dot" style={{ background: '#34d399' }} /> Recent</span>
          <span className="legend-item"><span className="legend-dot" style={{ background: '#60a5fa' }} /> 3-5yr</span>
          <span className="legend-item"><span className="legend-dot" style={{ background: '#94a3b8' }} /> Older</span>
          <span className="legend-item"><span className="legend-line dashed amber" /> Contradiction</span>
        </div>
      </div>
      <div className={`graph-canvas-wrap ${previewPanel ? 'panel-open' : ''}`}>
        <svg ref={svgRef} />

        {/* Slide-in preview panel */}
        {previewPanel && (
          <div className="graph-preview-panel">
            <div className="preview-header">
              <div className="preview-label">PAPER PREVIEW</div>
              <button className="preview-close" onClick={() => setPreviewPanel(null)}>&times;</button>
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

            <hr className="preview-divider" />

            <div>
              <div className="preview-summary-label">AI SUMMARY</div>
              {previewPanel.summary ? (
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>
                  {previewPanel.summary.replace(/[-•]\s*/g, '').slice(0, 250)}
                  {previewPanel.summary.length > 250 ? '...' : ''}
                </p>
              ) : (
                [1, 2, 3].map((i) => (
                  <div key={i} className="preview-skeleton" style={{ width: i === 3 ? '60%' : '100%' }} />
                ))
              )}
            </div>

            <div style={{ flex: 1 }} />

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
          </div>
        )}
      </div>
    </div>
  );
}
