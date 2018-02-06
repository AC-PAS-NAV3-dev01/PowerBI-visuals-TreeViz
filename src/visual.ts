module powerbi.extensibility.visual {
    "use strict";
    export class Visual implements IVisual {
        private svg: d3.Selection<SVGElement>;
        private svgG: d3.Selection<SVGElement>;
        private settings: VisualSettings;
        private previousUpdateData;

        private host: IVisualHost;
        private tooltips: VisualTooltipDataItem[];
        private element;

        constructor(options: VisualConstructorOptions) {
            //console.log('Visual constructor', options);
            this.svg = d3.select(options.element).append("svg").attr("style", "padding: 2px; display: block; min-width:99%");
            options.element.style.overflow = 'auto';
            this.host = options.host;
            this.element = options.element;
        }

        public update(options: VisualUpdateOptions) {
            // check if update is really needed
            if (JSON.stringify(options.dataViews) == this.previousUpdateData)
                return;
            else
                this.previousUpdateData = JSON.stringify(options.dataViews);
    
            // Clean everything
            this.svg.selectAll("g").remove();
            this.svgG = this.svg.append("g").attr("style", "display: block; margin: auto; overflow:auto; ");

            // Check if data are available and declare useful variables
            let _this = this;
            let dataViews = options.dataViews;
            if (!dataViews || !dataViews[0] || !dataViews[0].categorical || !dataViews[0].categorical.categories || !dataViews[0].categorical.categories[0].source) // || !dataViews[0].categorical.values)
                return;
            let categorical = options.dataViews[0].categorical;
            let maxColumns = categorical.categories[0].values.length;
            let maxRows = categorical.categories.length;
            let valuesRows = categorical.values ? categorical.values.length : 0;
            let nodeSeparator = 20;
            let nodeWidth = 100;
            let maxWidth = nodeWidth;
            let negWidth = 0;
            let maxDepth = 1;
            let boxClips;

            // Get settings from formatting
            this.settings = Visual.parseSettings(options && options.dataViews && options.dataViews[0]);

            // Make a tree functions
            function Nodex(data: string, parent) 
            {
                this.data = data;
                this.parent = parent;
                this.children = [];
                this.hiddenChildren = [];
                this.sums = []; // .sums[0] is reserved for count of subchildren
                this.prelim = 0;
                this.modif = 0;
                this.final = 0;
                this.shifted = -1; //!!
                this.substitution = false;
            }

            function fillSubTree(p, depth) // p is parent
            {
                if (depth >= maxRows)
                    return;
                let retval = new Array(valuesRows+1);
                for (let i = 0; i < valuesRows+1; i++)
                    retval[i] = 0;
                for (let i = 0; i < maxColumns; i++)
                {
                    let parentsFit = true;
                    let tmpNodex = p;
                    for (let j = depth; j > 0; j--)
                    {
                        if(tmpNodex.data != (categorical.categories[j-1].values[i] === null ? "(Blank)" : categorical.categories[j-1].values[i].toString()))
                        {
                            parentsFit = false;
                            break;
                        }
                        tmpNodex = tmpNodex.parent;
                    }
                    if(parentsFit) 
                    {
                        let push = true;
                        for (let child of p.children)
                        {
                            if (child.data == (categorical.categories[depth].values[i] === null ? "(Blank)" : categorical.categories[depth].values[i].toString()))
                            {
                                push = false;
                                break;
                            }
                        }
                        if (push)
                        {
                            tmpNodex = new Nodex((categorical.categories[depth].values[i] === null ? "(Blank)" : categorical.categories[depth].values[i].toString()), p);
                            if (depth == maxRows-1)
                            {
                                tmpNodex.sums[0] = 1;
                                retval[0] += 1;
                                for (let j = 1; j<valuesRows+1; j++)
                                {
                                    tmpNodex.sums[j] = parseFloat(categorical.values[j-1].values[i].toString());
                                    retval[j] += tmpNodex.sums[j];
                                }
                            }
                            else
                            {
                                tmpNodex.sums = fillSubTree(tmpNodex, depth + 1);
                                for (let j = 0; j<valuesRows+1; j++)
                                    retval[j] += tmpNodex.sums[j];
                            }
                            if(valuesRows > 0) // sort by first value, if possible
                            {
                                let j = 0;
                                while(j < p.children.length && tmpNodex.sums[1] < p.children[j].sums[1])
                                {
                                    j++;
                                }
                                p.children.splice(j,0,tmpNodex);
                            }
                            else
                            {
                                p.children.push(tmpNodex);
                            }
                        }
                    }
                }
                return retval;
            }

            function hide(node, top) 
            {
                if (node == null)
                    return;
                while(node.children.length > top)
                {
                    let tmpNodex = node.children.pop();
                    if (!tmpNodex.substitution)
                        node.hiddenChildren.unshift(tmpNodex);
                    hideAll(tmpNodex);
                }
                if(node.children.length > 0 && node.hiddenChildren.length > 0)
                {
                    let substNode = new Nodex("+ " + node.hiddenChildren.length , node);
                    substNode.substitution = true;
                    substNode.sums = [0];
                    for(let i = 0; i <= valuesRows; i++)
                    {
                        substNode.sums[i] = 0;
                        for(let j = 0; j < node.hiddenChildren.length; j++)
                            substNode.sums[i] += node.hiddenChildren[j].sums[i];
                    }
                    node.children.push(substNode);
                }
            }

            function hideAll(node)
            {
                for(let i = 0; node.children.length > i; i++)
                {
                    hideAll(node.children[i]);
                }
                hide(node,0);
            }

            function unhide(node, top) 
            {
                if (node == null)
                    return;
                if(node.children.length > 0 && node.children[node.children.length-1].substitution)
                {
                    node.children.pop();
                }
                if(node.children.length + node.hiddenChildren.length == top+1)
                {
                    top++;
                }
                while(node.children.length < top && node.hiddenChildren.length != 0)
                {
                    node.children.push(node.hiddenChildren.shift());
                }
                if(node.children.length > 0 && node.hiddenChildren.length > 0)
                {
                    let substNode = new Nodex("+ " + node.hiddenChildren.length , node);
                    substNode.substitution = true;
                    substNode.sums = [0];
                    for(let i = 0; i <= valuesRows; i++)
                    {
                        substNode.sums[i] = 0;
                        for(let j = 0; j < node.hiddenChildren.length; j++)
                            substNode.sums[i] += node.hiddenChildren[j].sums[i];
                    }
                    node.children.push(substNode);
                }
            }
            
            function unhideAll(node, intoDepth)
            {
                if (intoDepth <= 0)
                    return; 
                let unhideDown = true;
                if(!_this.settings.TreeVizSettings.drillBlank)
                    unhideDown = !isLastReasonable(node, "(Blank)");
                if(!_this.settings.TreeVizSettings.drillEmpty)
                    unhideDown = unhideDown && !isLastReasonable(node, "");
                if(unhideDown)
                {
                    unhide(node,_this.settings.TreeVizSettings.showLimit);
                }
                for(let i = 0; node.children.length > i; i++)
                {
                    unhideAll(node.children[i], intoDepth-1);
                }
            }


            function isLastReasonable(node, nonreasonable)
            {
                if (node.hiddenChildren.length + node.children.length == 0)
                    return true;
                else if (node.children.length > 0)
                    return false;
                else if (node.hiddenChildren.length != 1 || node.hiddenChildren[0].data != nonreasonable)
                    return false;
                else
                    return isLastReasonable(node.hiddenChildren[0], nonreasonable);
            }

            function rightmost(node, depth)
            {
                if(depth == 1) // i should return value of my rightmost child
                {
                    if(node.children.length > 0)
                    {
                        let retval = node.children[node.children.length-1].prelim;
                        let tmpNodex = node;
                        while (tmpNodex.parent != null)
                        {
                            retval += tmpNodex.modif;
                            tmpNodex = tmpNodex.parent;
                        }
                        return retval;
                    }
                    else
                        return -1000000;
                }
                else if(node.children.length > 0)
                {
                    let maximum = -1000000;
                    for(let i = 0; i < node.children.length; i++)
                    {
                        maximum = Math.max(maximum, rightmost(node.children[i], depth-1));
                    }
                    return maximum;
                }
                else
                    return -1000000;
            }

            function leftmost(node, depth)
            {
                if(depth == 1) // i should return value of my leftmost child
                {
                    if(node.children.length > 0)
                    {
                        let retval = node.children[0].prelim;
                        let tmpNodex = node;
                        while (tmpNodex.parent != null)
                        {
                            retval += tmpNodex.modif;
                            tmpNodex = tmpNodex.parent;
                        }
                        return retval;
                    }
                    else
                        return +1000000;
                }
                else if(node.children.length > 0)
                {
                    let maximum = +1000000;
                    for(let i = 0; i < node.children.length; i++)
                    {
                        maximum = Math.min(maximum, leftmost(node.children[i], depth-1));
                    }
                    return maximum;
                }
                else
                    return +1000000;
            }

            function firstWalk(node)
            {
                if (node == null)
                    return;
                node.children.forEach(firstWalk);
                let shifting = false;

                if(node.parent != null)
                {
                    if(node.parent.children[0] == node && node.children.length != 0)
                    {
                        node.prelim = (node.children[0].prelim + node.children[node.children.length-1].prelim)/2;
                    }
                    else if (node.parent.children[0] == node && node.children.length == 0)
                    {
                        node.prelim = 0;
                    }
                    else if (node.children.length == 0)
                    {
                        let i = 0;
                        for(; i < node.parent.children.length; i++)
                            if(node.parent.children[i] == node)
                                break;
                        if(i > 0)
                            node.prelim = node.parent.children[i-1].prelim + nodeSeparator + nodeWidth; 
                    }
                    else 
                    {
                        let i = 0;
                        for(; i < node.parent.children.length; i++)
                            if(node.parent.children[i] == node)
                                break;
                        if(i > 0)
                            node.prelim = node.parent.children[i-1].prelim + nodeSeparator + nodeWidth; 
                        node.modif = node.prelim - (node.children[0].prelim + node.children[node.children.length-1].prelim)/2;
                        shifting = true;
                    }
                }

                
                if(shifting) // i am parent
                {
                    // care that neighbors children doesnt conflict with my children
                    let shift = 0;
                    for(let r = 0; r < maxRows; r++)
                    {
                        for (let i = 0; i < node.parent.children.length && node.parent.children[i] != node; i++)
                        {
                            shift = Math.max(shift, rightmost(node.parent.children[i], r) - leftmost(node, r) + nodeSeparator + nodeWidth);   
                        }
                    }
                    node.modif += shift;    
                    node.prelim += shift;
                    node.shifted = shift;
                }
            }

            function secondWalk(node, modifs) 
            {
                if (node == null)
                    return;
                node.final = node.prelim + modifs;
                if(node.final > maxWidth)
                    maxWidth = node.final;
                if(node.final < negWidth)
                    negWidth = node.final;
                for(let i = 0; node.children.length > i; i++)
                {
                    secondWalk(node.children[i], node.modif + modifs);
                }
            }

            function finalDraw(node, depth, nth) 
            {
                if (node == null)
                    return;
                for(let i = 0; node.children.length > i; i++)
                {
                    finalDraw(node.children[i], depth+1, nth + ";" + i);
                }

                if (depth > maxDepth)
                    maxDepth = depth; 
                //console.log(node.data + " - final: " + node.final + " prelim: " + node.prelim + ", modif: " + node.modif + ", shift: " + node.shifted + " (" + !!node.parent.data + ")", depth);
                let timer;
                let box = _this.svgG.append("g").attr("class","box").attr("style", "clip-path: url(#boxClips)")
                    .on("mouseover", function (d) {
                        let e = d;
                        let tooltipData: VisualTooltipDataItem[] = [{
                            displayName: "Records",
                            value: node.sums[0],
                            header: node.data,
                        }]
                        for(let i = 1; i <= valuesRows; i++)
                        {
                            tooltipData.push({
                            displayName: categorical.values[i-1].source.displayName,
                            value: (node.sums[i].toFixed(0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")
                            })
                        }
                        _this.host.tooltipService.show({
                            dataItems: tooltipData,
                            identities: [],
                            coordinates: [(d3.mouse(this)[0]-_this.element.scrollLeft),(d3.mouse(this)[1]-_this.element.scrollTop)],
                            isTouchEvent: false
                        });
                    })
                    .on("mousemove", function (d) {
                        let tooltipData: VisualTooltipDataItem[] = [{
                            displayName: "Records",
                            value: node.sums[0],
                            header: node.data
                        }]
                        for(let i = 1; i <= valuesRows; i++)
                        {
                            tooltipData.push({
                            displayName: categorical.values[i-1].source.displayName,
                            value: (node.sums[i].toFixed(0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")
                            })
                        }
                        _this.host.tooltipService.move({
                            dataItems: tooltipData,
                            identities: [],
                            coordinates: [(d3.mouse(this)[0]-_this.element.scrollLeft),(d3.mouse(this)[1]-_this.element.scrollTop)],
                            isTouchEvent: false,
                        });
                    })                    
                    .on("mouseout", function (d) {
                        _this.host.tooltipService.hide({
                            immediately: true,
                            isTouchEvent: false
                        });
                    });
                box.append("rect").attr("x", node.final - negWidth).attr("y", depth*100).attr("width",100).attr("height",60)
                    .attr("fill",_this.settings.TreeVizFormat.boxbg).attr("stroke",_this.settings.TreeVizFormat.lines).attr("rx", node.substitution ? _this.settings.TreeVizFormat.Rx : _this.settings.TreeVizFormat.rx);
                boxClips.append("rect").attr("x", node.final - negWidth).attr("y", depth*100).attr("class","boxbg").attr("rx", node.substitution ? _this.settings.TreeVizFormat.Rx : _this.settings.TreeVizFormat.rx).attr("width",100).attr("height",60);
                let fullWidth = (<SVGTextElement> box.append("text").attr("x", -1000).attr("y", -1000).attr("class","boxhead").text(node.data).node()).getComputedTextLength();
                let i = 0;
                while (fullWidth > nodeWidth)
                {
                    i++;
                    fullWidth = (<SVGTextElement> box.append("text").attr("x", -1000).attr("y", -1000).attr("class","boxhead").text((node.data.substring(0,(node.data).length-i) + "...")).node()).getComputedTextLength();
                }
                box.selectAll("text").remove();

                box.append("text").attr("x", node.final + nodeWidth/2 - negWidth).attr("y", depth*100+(_this.settings.TreeVizSettings.showMeasure ? 18 : 28)).attr("class","boxhead")
                    .text(node.data.substring(0,(node.data).length-i) + (i==0 ? "" : "..."));
                
                if(_this.settings.TreeVizSettings.showMeasure)
                {
                    if(node.parent != null)
                    {
                        // top bar (of total)
                        let ratio = node.sums[valuesRows > 0 ? 1 : 0]/_root.sums[valuesRows > 0 ? 1 : 0], barClass = "white", rotation = "0";
                        if (ratio > 1) {
                            barClass = "fullGreen"; ratio = 1;
                        } else if (ratio >= 0) {
                            barClass = "halfGreen";
                        } else if (ratio >= -1) {
                            ratio = -ratio; barClass = "halfRed"; rotation = "180";
                        } else {
                            barClass = "fullRed"; ratio = 1; rotation = "180";
                        }
                        box.append("rect").attr("x", node.final - negWidth).attr("y", depth*100+24).attr("width", ratio*nodeWidth).attr("height", 9)
                            .attr("class", barClass).attr("transform","rotate(" + rotation + " " + (node.final + nodeWidth/2 - negWidth) + " " + (depth*100+24+4.5) + ")");
                        // bottom bar (of parent)
                        ratio = node.sums[valuesRows > 0 ? 1 : 0]/node.parent.sums[valuesRows > 0 ? 1 : 0]; barClass = "white"; rotation = "0";
                        if (ratio > 1) {
                            barClass = "fullGreen"; ratio = 1;
                        } else if (ratio >= 0) {
                            barClass = "halfGreen";
                        } else if (ratio >= -1) {
                            ratio = -ratio; barClass = "halfRed"; rotation = "180";
                        } else {
                            barClass = "fullRed"; ratio = 1; rotation = "180";
                        }
                        box.append("rect").attr("x", node.final - negWidth).attr("y", depth*100+24+9).attr("width", ratio*nodeWidth).attr("height", 9)
                            .attr("class", barClass).attr("transform","rotate(" + rotation + " " + (node.final + nodeWidth/2 - negWidth) + " " + (depth*100+24+9+4.5) + ")");
                    }
                    box.append("text").attr("x", node.final + nodeWidth/2 - negWidth).attr("y", depth*100+38).attr("class","value")
                        .text(node.sums[valuesRows > 0 ? 1 : 0].toFixed(0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " "));
                    box.append("text").attr("x", node.final + nodeWidth/2 - negWidth).attr("y", depth*100+38).attr("class","percentage")
                        .text((node.sums[valuesRows > 0 ? 1 : 0]/_root.sums[valuesRows > 0 ? 1 : 0]*100).toFixed(1) + " " + ((depth <= 1) ? "" : "| " + (node.sums[valuesRows > 0 ? 1 : 0]/node.parent.sums[valuesRows > 0 ? 1 : 0]*100).toFixed(1)) + " %");
                }
                let showDrill = true;
                if(!_this.settings.TreeVizSettings.drillBlank)
                    showDrill = !isLastReasonable(node, "(Blank)");
                if(!_this.settings.TreeVizSettings.drillEmpty)
                    showDrill = showDrill && !isLastReasonable(node, "");

                if (!node.substitution && depth < maxRows && showDrill)
                {
                    let prevBtn = box.append("g").attr("class","drillBtn") 
                    .on("click", function (d) {
                        if (node.children.length == 0)
                            unhide(node,_this.settings.TreeVizSettings.showLimit);
                        else
                            hideAll(node);
                        drawAll();
                    });
                    prevBtn.append("circle").attr("cx", node.final + nodeWidth/2 - negWidth).attr("cy", depth*100+51).attr("r",  8).attr("class","drillCrc")
                    if(node.children.length == 0)
                        prevBtn.append("path").attr("class", "arrow")
                            .attr("d", "M " + (node.final - negWidth + nodeWidth/2) + " " + (depth*100+51) + " m -5 -4 l 5 5 l 5 -5 m -10 4 l 5 5 l 5 -5 ");
                    else
                        prevBtn.append("path").attr("class", "arrow")
                            .attr("d", "M " + (node.final - negWidth + nodeWidth/2) + " " + (depth*100+51) + " m -5 4 l 5 -5 l 5 5 m -10 -4 l 5 -5 l 5 5 ");
                }
                if (node.substitution)
                {
                    let prevBtn = box.append("g").attr("class","nextBtn") 
                    .on("click", function (d) {
                        unhide(node.parent, node.parent.children.length+2);
                        drawAll();
                    });
                    prevBtn.append("circle").attr("cx", node.final - negWidth + nodeWidth/2 + 25).attr("cy", depth*100+51).attr("r",  8).attr("class","nextCrc")
                    prevBtn.append("path").attr("class", "arrow")
                        .attr("d", "M " + (node.final - negWidth + nodeWidth/2 + 25) + " " + (depth*100+51) + " m -4 -5 l 5 5 l -5 5 m 4 -10 l 5 5 l -5 5 ");
                }
                if (node.parent != null && node.parent.children.length > 2 && node.parent.children[node.parent.children.length-1] == node)
                {
                    let prevBtn = box.append("g").attr("class","prevBtn") 
                    .on("click", function (d) {
                        hide(node.parent, Math.max(1,node.parent.children.length-4));
                        drawAll();
                    });
                    prevBtn.append("circle").attr("cx", node.final - negWidth + nodeWidth/2 - 25).attr("cy", depth*100+51).attr("r",  8).attr("class","prevCrc")
                    prevBtn.append("path").attr("class", "arrow")
                        .attr("d", "M " + (node.final - negWidth + nodeWidth/2 - 25) + " " + (depth*100+51) + " m 4 -5 l -5 5 l 5 5 m -4 -10 l -5 5 l 5 5 ");
                }
                
                if(depth > 0)
                {
                    _this.svgG.append("line").attr("x1", node.final + nodeWidth/2 - negWidth).attr("y1", depth*100)
                        .attr("x2", node.parent.final + nodeWidth/2  - negWidth).attr("y2", (depth-1)*100+60).attr("stroke", _this.settings.TreeVizFormat.lines);
                }
            }

            function drawAll()
            {
                _this.svg.selectAll("g").remove();
                _this.svgG = _this.svg.append("g").attr("style", "display: block; margin: auto; overflow:auto;");
                boxClips = _this.svgG.append("defs").append("clipPath").attr("id","boxClips");
                negWidth = 0;
                maxDepth = 0;
                maxWidth = nodeWidth;
                firstWalk(_root);
                secondWalk(_root, 0); 
                negWidth -= 10;
                if(_root.children.length > 0)
                    _root.final = (_root.children[0].final + _root.children[_root.children.length-1].final)/2;
                else
                    _root.final = 0;
                finalDraw(_root, 0, "0"); //draw
                _this.svg.attr("width", maxWidth + nodeWidth + 10 - negWidth).attr("height",(maxDepth+1)*100-30);
            }

            let _root = new Nodex((_this.settings.TreeVizSettings.showMeasure ? "Total" : "Everything"), null);
            _root.sums = fillSubTree(_root,0); // fill
            hideAll(_root);
            unhideAll(_root,_this.settings.TreeVizSettings.defaultDrillDown);
            drawAll();

            //console.log(_root);
        }
        
        private static parseSettings(dataView: DataView): VisualSettings {
            return VisualSettings.parse(dataView) as VisualSettings;
        }

        public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] | VisualObjectInstanceEnumerationObject {
            return VisualSettings.enumerateObjectInstances(this.settings || VisualSettings.getDefault(), options);
        }
    }
}