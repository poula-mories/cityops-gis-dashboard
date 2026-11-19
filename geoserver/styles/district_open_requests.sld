<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <NamedLayer>
    <Name>district_open_requests</Name>
    <UserStyle>
      <Title>Open requests per district</Title>
      <FeatureTypeStyle>
        <Rule><Name>low</Name><Title>6 or fewer open</Title>
          <ogc:Filter><ogc:PropertyIsLessThan><ogc:PropertyName>open_requests</ogc:PropertyName><ogc:Literal>7</ogc:Literal></ogc:PropertyIsLessThan></ogc:Filter>
          <PolygonSymbolizer>
            <Fill><CssParameter name="fill">#ccfbf1</CssParameter><CssParameter name="fill-opacity">0.55</CssParameter></Fill>
            <Stroke><CssParameter name="stroke">#0f766e</CssParameter><CssParameter name="stroke-width">1.2</CssParameter></Stroke>
          </PolygonSymbolizer>
        </Rule>
        <Rule><Name>medium</Name><Title>7 - 11 open</Title>
          <ogc:Filter><ogc:And>
            <ogc:PropertyIsGreaterThanOrEqualTo><ogc:PropertyName>open_requests</ogc:PropertyName><ogc:Literal>7</ogc:Literal></ogc:PropertyIsGreaterThanOrEqualTo>
            <ogc:PropertyIsLessThan><ogc:PropertyName>open_requests</ogc:PropertyName><ogc:Literal>12</ogc:Literal></ogc:PropertyIsLessThan>
          </ogc:And></ogc:Filter>
          <PolygonSymbolizer>
            <Fill><CssParameter name="fill">#5eead4</CssParameter><CssParameter name="fill-opacity">0.55</CssParameter></Fill>
            <Stroke><CssParameter name="stroke">#0f766e</CssParameter><CssParameter name="stroke-width">1.2</CssParameter></Stroke>
          </PolygonSymbolizer>
        </Rule>
        <Rule><Name>high</Name><Title>12+ open</Title>
          <ogc:Filter><ogc:PropertyIsGreaterThanOrEqualTo><ogc:PropertyName>open_requests</ogc:PropertyName><ogc:Literal>12</ogc:Literal></ogc:PropertyIsGreaterThanOrEqualTo></ogc:Filter>
          <PolygonSymbolizer>
            <Fill><CssParameter name="fill">#0d9488</CssParameter><CssParameter name="fill-opacity">0.55</CssParameter></Fill>
            <Stroke><CssParameter name="stroke">#0f766e</CssParameter><CssParameter name="stroke-width">1.2</CssParameter></Stroke>
          </PolygonSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
