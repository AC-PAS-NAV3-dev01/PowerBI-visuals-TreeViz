module powerbi.extensibility.visual {
    "use strict";
    import DataViewObjectsParser = powerbi.extensibility.utils.dataview.DataViewObjectsParser;

    export class VisualSettings extends DataViewObjectsParser {
      public TreeVizSettings: TreeVizSettings = new TreeVizSettings();
      public TreeVizFormat: TreeVizFormat = new TreeVizFormat();
      }

    export class TreeVizSettings {
      // Show measures and bars
        public showMeasure: boolean = true;
      // Drill into blank values
        public drillBlank: boolean = true; 
      // Drill into empty values
        public drillEmpty: boolean = true;        
      // Limit number of children
        public showLimit: number = 5;
      // Default drilldown
        public defaultDrillDown: number = 3;
      }

      export class TreeVizFormat {
        // Box background color
          public boxbg: string = "#d0eef7";
        // Box border color
          public lines: string = "#475052";
        // Radius of data values
          public rx: number = 0;
        // Radius of substitution values
          public Rx: number = 30;
      }
}
