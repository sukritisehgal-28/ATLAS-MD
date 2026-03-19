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

export default function ResearchGraph({ papers, relationships, summaries, onSelectPaper, selectedPaperId }) {
  const svgRef = useRef(null);
  const simulationRef = useRef(null);
  const [popup, setPopup] = useState(null);

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
    console.log('[ResearchGraph] nodeIds:', [...nodeIds]);
    console.log('[ResearchGraph] relationships:', relationships);
    const links = relationships
      .filter((r) => nodeIds.has(r.paper1_id) && nodeIds.has(r.paper2_id))
      .map((r) => ({
        source: r.paper1_id,
        target: r.paper2_id,
        type: r.type,
        strength: r.strength || 0.5,
        reason: r.reason,
      }));
    console.log('[ResearchGraph] filtered links:', links.length);

    const defs = svg.append('defs');

    // Glow filter
    const glow = defs.append('filter').attr('id', 'node-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    glow.append('feGaussianBlur').attr('stdDeviation', '6').attr('result', 'blur');
    const merge = glow.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Selected glow
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

    // Links — rendered BEFORE nodes so they appear behind
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
          // Get position relative to the SVG container
          const svgRect = svgRef.current.getBoundingClientRect();
          const wrapRect = svgRef.current.parentElement.getBoundingClientRect();
          const transform = d3.zoomTransform(svgRef.current);
          const screenX = transform.applyX(d.x) + (svgRect.left - wrapRect.left);
          const screenY = transform.applyY(d.y) + (svgRect.top - wrapRect.top);
          setPopup({
            paper,
            summary: summaries?.[paper.paperId] || null,
            x: Math.min(Math.max(screenX - 160, 10), width - 340),
            y: Math.min(Math.max(screenY + d.radius + 15, 10), height - 300),
          });
        }
      });

    // Close popup on background click
    svg.on('click', () => setPopup(null));

    // Contradiction ring
    node.filter((d) => d.hasContradiction)
      .append('circle')
      .attr('r', (d) => d.radius + 8)
      .attr('fill', 'none')
      .attr('stroke', '#f59e0b')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '5,4')
      .attr('opacity', 0.6);

    // Outer glow circle
    node.append('circle')
      .attr('r', (d) => d.radius + 4)
      .attr('fill', (d) => d.color)
      .attr('fill-opacity', 0.12)
      .style('filter', (d) => d.id === selectedPaperId ? 'url(#selected-glow)' : 'url(#node-glow)');

    // Main circle
    node.append('circle')
      .attr('r', (d) => d.radius)
      .attr('fill', (d) => d.color)
      .attr('fill-opacity', 0.9)
      .attr('stroke', (d) => d.id === selectedPaperId ? '#ffffff' : 'rgba(255,255,255,0.15)')
      .attr('stroke-width', (d) => d.id === selectedPaperId ? 2.5 : 1);

    // Inner highlight
    node.append('circle')
      .attr('r', (d) => d.radius * 0.5)
      .attr('fill', 'rgba(255,255,255,0.12)')
      .attr('pointer-events', 'none');

    // Label below node
    node.append('text')
      .text((d) => d.title.length > 22 ? d.title.slice(0, 20) + '...' : d.title)
      .attr('dy', (d) => d.radius + 16)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(255,255,255,0.55)')
      .attr('font-size', '9px')
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .attr('pointer-events', 'none');

    // Year inside node
    node.append('text')
      .text((d) => d.year || '')
      .attr('dy', 4)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(255,255,255,0.85)')
      .attr('font-size', '10px')
      .attr('font-weight', '700')
      .attr('font-family', 'Inter, system-ui, sans-serif')
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

    // Zoom to fit after simulation settles
    simulationRef.current.on('end', () => {
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
  }, [papers, relationships, summaries, selectedPaperId, onSelectPaper]);

  useEffect(() => {
    setPopup(null);
    buildGraph();
    return () => { if (simulationRef.current) simulationRef.current.stop(); };
  }, [buildGraph]);

  return (
    <div className="research-graph dark">
      <div className="graph-top-bar">
        <div className="graph-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <span>Knowledge Graph</span>
        </div>
        <div className="graph-legend dark">
          <span className="legend-item"><span className="legend-dot" style={{ background: '#34d399' }} /> Recent</span>
          <span className="legend-item"><span className="legend-dot" style={{ background: '#60a5fa' }} /> 3-5yr</span>
          <span className="legend-item"><span className="legend-dot" style={{ background: '#94a3b8' }} /> Older</span>
          <span className="legend-item"><span className="legend-line dashed amber" /> Contradiction</span>
        </div>
      </div>
      <div className="graph-canvas-wrap">
        <svg ref={svgRef} />
        {popup && (
          <div
            className="graph-popup"
            style={{ left: popup.x, top: popup.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="popup-arrow" />
            <button className="popup-close" onClick={() => setPopup(null)}>&times;</button>
            <h4>{popup.paper.title}</h4>
            <div className="popup-meta">
              <span className="popup-chip">{popup.paper.year}</span>
              <span className="popup-chip">{popup.paper.citationCount || 0} citations</span>
              <span className="popup-authors">
                {popup.paper.authors?.slice(0, 2).map((a) => a.name).join(', ')}
                {popup.paper.authors?.length > 2 ? ' et al.' : ''}
              </span>
            </div>
            {popup.summary && (
              <p className="popup-summary">
                {popup.summary.slice(0, 300)}
              </p>
            )}
            {!popup.summary && popup.paper.abstract && (
              <p className="popup-abstract">{popup.paper.abstract.slice(0, 250)}...</p>
            )}
            <div className="popup-links">
              {popup.paper.openAccessPdf?.url && (
                <a href={popup.paper.openAccessPdf.url} target="_blank" rel="noopener noreferrer">View PDF</a>
              )}
              {popup.paper.url && (
                <a href={popup.paper.url} target="_blank" rel="noopener noreferrer">Semantic Scholar</a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
