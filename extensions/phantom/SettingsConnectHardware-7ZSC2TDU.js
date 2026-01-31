import{a as N,c as F,d as G,g as I}from"./chunk-7IBR5DPP.js";import{a as x}from"./chunk-7L72CR4K.js";import"./chunk-7HKJSCWA.js";import{a as D}from"./chunk-GYTBAGR6.js";import"./chunk-574WVIUC.js";import"./chunk-D6VXIX5C.js";import"./chunk-35US6LTY.js";import"./chunk-L4IYRNK4.js";import"./chunk-VRODSUQC.js";import"./chunk-27WMCVHA.js";import"./chunk-TRIYFLMU.js";import"./chunk-J4XA5VC7.js";import"./chunk-DQWLAPQA.js";import"./chunk-IUNAS73H.js";import"./chunk-2LKSWQ7Y.js";import"./chunk-H4HL2VJ5.js";import{a as L}from"./chunk-QKX6QMZS.js";import"./chunk-5ENLJTSW.js";import"./chunk-ZMW27YAP.js";import"./chunk-QW5UCU4W.js";import"./chunk-X6Z5FRDC.js";import"./chunk-X4RRAJ67.js";import"./chunk-FFV6ZRAV.js";import"./chunk-END3S5WW.js";import"./chunk-OABENO2E.js";import"./chunk-VQU4JTIB.js";import{a as C}from"./chunk-ZMU6KWZP.js";import"./chunk-YSZRDBUS.js";import"./chunk-657ZALHT.js";import"./chunk-UE7TCZBL.js";import"./chunk-PFY5DZIQ.js";import"./chunk-L4NFABLQ.js";import"./chunk-P3JRRYSB.js";import"./chunk-TCAPEBDX.js";import"./chunk-FJWAMDUD.js";import"./chunk-GUZFMB3D.js";import"./chunk-N3C6FBKY.js";import"./chunk-CTKHELYY.js";import"./chunk-2L6X42XL.js";import"./chunk-2P4HZW3J.js";import"./chunk-OR3XQXDJ.js";import"./chunk-HLSJ3VIL.js";import{m as s,v as _}from"./chunk-57EVB5FV.js";import{a as y}from"./chunk-6L5OAXTQ.js";import"./chunk-44HH5QGP.js";import"./chunk-WVRYN4MY.js";import"./chunk-2LSP5LV2.js";import"./chunk-HLWWEHZK.js";import"./chunk-5JGASDWN.js";import"./chunk-ZDPKBPMV.js";import"./chunk-DYQ7BPYX.js";import"./chunk-NMTPXQAP.js";import"./chunk-SIWEHH3L.js";import"./chunk-N6SSDFMX.js";import"./chunk-YJCG6GWC.js";import{lb as $,rb as O}from"./chunk-W7IWPUIQ.js";import"./chunk-4SCKDS7G.js";import{Ge as P,pe as E}from"./chunk-DJGGVTSJ.js";import"./chunk-FATTDLFQ.js";import"./chunk-2RWUL32J.js";import"./chunk-RWWUDPHX.js";import{Ca as e,Za as R,a as z,b as u,bb as T}from"./chunk-LQZGQEJ6.js";import"./chunk-FNC6PQ53.js";import"./chunk-5QQLABHI.js";import{a as g,g as l,i as n,n as i}from"./chunk-WKJYWAXG.js";n();i();var f=l(z(),1);n();i();n();i();var M=s(C)`
  cursor: pointer;
  width: 24px;
  height: 24px;
  transition: background-color 200ms ease;
  background-color: ${t=>t.$isExpanded?e.colors.legacy.black:e.colors.legacy.elementAccent} !important;
  :hover {
    background-color: ${e.colors.legacy.gray};
    svg {
      fill: white;
    }
  }
  svg {
    fill: ${t=>t.$isExpanded?"white":e.colors.legacy.textDiminished};
    transition: fill 200ms ease;
    position: relative;
    ${t=>t.top?`top: ${t.top}px;`:""}
    ${t=>t.right?`right: ${t.right}px;`:""}
  }
`;var o=l(u(),1),K=s(L).attrs({justify:"space-between"})`
  background-color: ${e.colors.legacy.areaBase};
  padding: 10px 16px;
  border-bottom: 1px solid ${e.colors.legacy.borderDiminished};
  height: 46px;
  opacity: ${t=>t.opacity??"1"};
`,Q=s.div`
  display: flex;
  margin-left: 10px;
  > * {
    margin-right: 10px;
  }
`,W=s.div`
  width: 24px;
  height: 24px;
`,X=g(({onBackClick:t,totalSteps:c,currentStepIndex:d,isHidden:m,showBackButtonOnFirstStep:r,showBackButton:S=!0})=>(0,o.jsxs)(K,{opacity:m?0:1,children:[S&&(r||d!==0)?(0,o.jsx)(M,{right:1,onClick:t,children:(0,o.jsx)(_,{})}):(0,o.jsx)(W,{}),(0,o.jsx)(Q,{children:E(c).map(p=>{let h=p<=d?e.colors.legacy.spotBase:e.colors.legacy.elementAccent;return(0,o.jsx)(C,{diameter:12,color:h},p)})}),(0,o.jsx)(W,{})]}),"StepHeader");n();i();var a=l(u(),1),Z=g(()=>{let{mutateAsync:t}=O(),{hardwareStepStack:c,pushStep:d,popStep:m,currentStep:r,setOnConnectHardwareAccounts:S,setOnConnectHardwareDone:b,setExistingAccounts:p}=N(),{data:h=[],isFetched:H,isError:v}=$(),w=P(c,(k,q)=>k?.length===q.length),J=c.length>(w??[]).length,B=w?.length===0,U={initial:{x:B?0:J?150:-150,opacity:B?1:0},animate:{x:0,opacity:1},exit:{opacity:0},transition:{duration:.2}},V=(0,f.useCallback)(()=>{r()?.props.preventBack||(r()?.props.onBackCallback&&r()?.props.onBackCallback?.(),m())},[r,m]);return D(()=>{S(async k=>{await t(k),await y.set(x,!await y.get(x))}),b(()=>self.close()),d((0,a.jsx)(I,{}))},c.length===0),(0,f.useEffect)(()=>{p({data:h,isFetched:H,isError:v})},[h,H,v,p]),(0,a.jsxs)(F,{children:[(0,a.jsx)(X,{totalSteps:3,onBackClick:V,showBackButton:!r()?.props.preventBack,currentStepIndex:c.length-1}),(0,a.jsx)(R,{mode:"wait",children:(0,a.jsx)(T.div,{style:{display:"flex",flexGrow:1},...U,children:(0,a.jsx)(G,{children:r()})},`${c.length}_${w?.length}`)})]})},"SettingsConnectHardware"),Tt=Z;export{Tt as default};
//# sourceMappingURL=SettingsConnectHardware-7ZSC2TDU.js.map
