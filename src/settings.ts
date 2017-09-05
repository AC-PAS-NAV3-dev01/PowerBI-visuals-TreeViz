module powerbi.extensibility.visual {
    "use strict";
    import DataViewObjectsParser = powerbi.extensibility.utils.dataview.DataViewObjectsParser;

    export class VisualSettings extends DataViewObjectsParser {
      public TreeViz: TreeVizSettings = new TreeVizSettings();
      }

    export class TreeVizSettings {
      // Show measures and bars
        public showMeasure: boolean = true;
      // Limit number of children
        public showLimit: number = 5;
      }
}
