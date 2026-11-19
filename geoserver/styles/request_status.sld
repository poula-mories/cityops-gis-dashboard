<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <NamedLayer>
    <Name>request_status</Name>
    <UserStyle>
      <Title>Service requests by status</Title>
      <FeatureTypeStyle>
        <Rule><Name>new</Name><Title>New</Title>
          <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>status</ogc:PropertyName><ogc:Literal>new</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
          <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
            <Fill><CssParameter name="fill">#2563eb</CssParameter></Fill>
            <Stroke><CssParameter name="stroke">#ffffff</CssParameter></Stroke></Mark><Size>9</Size></Graphic></PointSymbolizer>
        </Rule>
        <Rule><Name>in_review</Name><Title>In review</Title>
          <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>status</ogc:PropertyName><ogc:Literal>in_review</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
          <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
            <Fill><CssParameter name="fill">#f59e0b</CssParameter></Fill>
            <Stroke><CssParameter name="stroke">#ffffff</CssParameter></Stroke></Mark><Size>9</Size></Graphic></PointSymbolizer>
        </Rule>
        <Rule><Name>approved</Name><Title>Approved</Title>
          <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>status</ogc:PropertyName><ogc:Literal>approved</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
          <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
            <Fill><CssParameter name="fill">#16a34a</CssParameter></Fill>
            <Stroke><CssParameter name="stroke">#ffffff</CssParameter></Stroke></Mark><Size>9</Size></Graphic></PointSymbolizer>
        </Rule>
        <Rule><Name>rejected</Name><Title>Rejected</Title>
          <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>status</ogc:PropertyName><ogc:Literal>rejected</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
          <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
            <Fill><CssParameter name="fill">#dc2626</CssParameter></Fill>
            <Stroke><CssParameter name="stroke">#ffffff</CssParameter></Stroke></Mark><Size>9</Size></Graphic></PointSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
