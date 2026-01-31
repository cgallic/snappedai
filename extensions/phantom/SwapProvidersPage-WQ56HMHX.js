import{e as H,p as $,za as I}from"./chunk-VRODSUQC.js";import"./chunk-27WMCVHA.js";import"./chunk-TRIYFLMU.js";import"./chunk-J4XA5VC7.js";import"./chunk-DQWLAPQA.js";import{s as T}from"./chunk-IUNAS73H.js";import"./chunk-2LKSWQ7Y.js";import"./chunk-H4HL2VJ5.js";import{a as h}from"./chunk-QKX6QMZS.js";import"./chunk-5ENLJTSW.js";import"./chunk-ZMW27YAP.js";import"./chunk-QW5UCU4W.js";import"./chunk-X6Z5FRDC.js";import"./chunk-X4RRAJ67.js";import"./chunk-FFV6ZRAV.js";import"./chunk-END3S5WW.js";import{a as b}from"./chunk-OABENO2E.js";import"./chunk-VQU4JTIB.js";import"./chunk-ZMU6KWZP.js";import"./chunk-YSZRDBUS.js";import"./chunk-UE7TCZBL.js";import"./chunk-PFY5DZIQ.js";import"./chunk-L4NFABLQ.js";import"./chunk-P3JRRYSB.js";import"./chunk-GUZFMB3D.js";import"./chunk-N3C6FBKY.js";import"./chunk-CTKHELYY.js";import{b as L}from"./chunk-2L6X42XL.js";import"./chunk-2P4HZW3J.js";import"./chunk-OR3XQXDJ.js";import"./chunk-HLSJ3VIL.js";import{m as u}from"./chunk-57EVB5FV.js";import{Ma as k,Q as P,Va as C}from"./chunk-44HH5QGP.js";import"./chunk-WVRYN4MY.js";import"./chunk-2LSP5LV2.js";import"./chunk-HLWWEHZK.js";import"./chunk-5JGASDWN.js";import"./chunk-ZDPKBPMV.js";import"./chunk-DYQ7BPYX.js";import"./chunk-NMTPXQAP.js";import"./chunk-SIWEHH3L.js";import"./chunk-N6SSDFMX.js";import"./chunk-YJCG6GWC.js";import"./chunk-W7IWPUIQ.js";import"./chunk-4SCKDS7G.js";import"./chunk-DJGGVTSJ.js";import"./chunk-FATTDLFQ.js";import"./chunk-2RWUL32J.js";import"./chunk-RWWUDPHX.js";import{Aa as y,Ca as d,Ra as B,Ua as t,Z as S,a as E,b as R}from"./chunk-LQZGQEJ6.js";import"./chunk-FNC6PQ53.js";import"./chunk-5QQLABHI.js";import{a,g as w,i as v,n as x}from"./chunk-WKJYWAXG.js";v();x();var m=w(E(),1);var e=w(R(),1),A=72,F=52,_=u.ul`
  margin: 0;
  padding: 0;
  height: ${o=>o.fullHeight?410:360}px;
  overflow: auto;
`,V=u.li`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  background: ${o=>o.isSelected?d.colors.legacy.spotBase:d.colors.legacy.elementBase};
  border-radius: 6px;
  min-height: ${F}px;
  padding: 16px;
  margin-bottom: 10px;
  &:hover {
    background: ${o=>o.isSelected?d.colors.legacy.spotAccent:d.colors.legacy.elementAccent};
  }
`,N=u(V)`
  height: ${A}px;
  padding: 12px;
`,G=a(()=>{let{t:o}=S(),{handleHideModalVisibility:r}=I(),i=(0,m.useCallback)(()=>{r("swapProviders")},[r]),{selectQuote:n}=C(),s=k({selectQuote:n}),f=(0,m.useCallback)(l=>{s.setSelectedProviderIndex(l),i()},[i,s]),c=s.rows.some(P),g=o(c?"swapProvidersTitle":"swapTopQuotesTitle"),p=o("swapProvidersFee");return{...s,hideSwapProvidersModal:i,onClick:f,isBridge:c,title:g,feesLabel:p}},"useSwapProvidersPropsViewProps"),M=a(({isBridge:o})=>(0,e.jsx)(e.Fragment,{children:[...Array(5)].map((r,i)=>(0,e.jsx)(T,{align:"center",width:"100%",height:`${o?A:F}px`,backgroundColor:d.colors.legacy.elementBase,borderRadius:"8px",margin:"0 0 10px 0",padding:"10px"},`swap-provider-row-loader-${i}`))}),"SkeletonListLoader"),Q=m.default.memo(({rows:o,selectedProviderIndex:r,isLoadingProviders:i,title:n,isBridge:s,feesLabel:f,hideSwapProvidersModal:c,onClick:g})=>(0,e.jsxs)(L,{onReset:c,children:[(0,e.jsx)($,{leftButton:{type:"close",onClick:c},children:n}),i?(0,e.jsx)(M,{isBridge:s}):(0,e.jsx)(_,{fullHeight:s,children:o.map((p,l)=>{let D=l===r;return P(p)?(0,e.jsx)(j,{index:l,row:p,onClick:g,feesLabel:f},`bridge-provider-row-${l}`):(0,e.jsx)(W,{index:l,row:p,onClick:g,isSelected:D},`provider-row-${l}`)})})]})),U=a(()=>{let o=G();return(0,e.jsx)(Q,{...o})},"SwapProvidersPage"),ne=U,W=a(({index:o,row:r,isSelected:i,onClick:n})=>(0,e.jsxs)(V,{isSelected:i,onClick:()=>n(o),children:[(0,e.jsx)(t,{font:"label",children:r.name,align:"left",color:i?"areaBase":"white"}),(0,e.jsx)(t,{font:"label",children:r.amount,align:"right",color:i?"areaBase":"textDiminished",className:y({flexShrink:0})})]}),"ProviderRow"),j=a(({index:o,row:r,onClick:i,feesLabel:n})=>(0,e.jsxs)(N,{onClick:()=>i(o),children:[r.logoURI?(0,e.jsx)(b,{flex:0,margin:"0 4px 0 0",children:(0,e.jsx)(B,{src:r.logoURI,width:48,height:48})}):null,(0,e.jsxs)(b,{flex:1,children:[(0,e.jsxs)(h,{justify:"space-between",children:[(0,e.jsx)(t,{children:r.name,font:"labelSemibold",color:"white",align:"left"}),(0,e.jsx)(t,{children:r.amount,font:"labelSemibold",color:"white",align:"right"})]}),(0,e.jsxs)(h,{justify:"space-between",padding:"8px 0 0 0",children:[(0,e.jsx)(t,{children:r.time.text,font:"label",color:r.time.isFast?"textDiminished":"spotNegative"}),(0,e.jsxs)(t,{children:[(0,e.jsx)(H,{color:"textDiminished",font:"label",value:r.feeUsd}),(0,e.jsx)(t,{children:n,color:"textDiminished",font:"label",marginLeft:4})]})]})]})]}),"BridgeProviderRowComponent");export{U as SwapProvidersPage,ne as default};
//# sourceMappingURL=SwapProvidersPage-WQ56HMHX.js.map
