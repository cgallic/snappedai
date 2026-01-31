import{f as C}from"./chunk-5U2TK6YQ.js";import{za as h}from"./chunk-VRODSUQC.js";import"./chunk-27WMCVHA.js";import"./chunk-TRIYFLMU.js";import"./chunk-J4XA5VC7.js";import"./chunk-DQWLAPQA.js";import"./chunk-IUNAS73H.js";import"./chunk-2LKSWQ7Y.js";import"./chunk-H4HL2VJ5.js";import"./chunk-QKX6QMZS.js";import"./chunk-5ENLJTSW.js";import"./chunk-ZMW27YAP.js";import"./chunk-QW5UCU4W.js";import"./chunk-X6Z5FRDC.js";import"./chunk-X4RRAJ67.js";import"./chunk-FFV6ZRAV.js";import"./chunk-END3S5WW.js";import"./chunk-OABENO2E.js";import"./chunk-VQU4JTIB.js";import"./chunk-ZMU6KWZP.js";import"./chunk-YSZRDBUS.js";import"./chunk-UE7TCZBL.js";import"./chunk-PFY5DZIQ.js";import"./chunk-L4NFABLQ.js";import"./chunk-P3JRRYSB.js";import"./chunk-FJWAMDUD.js";import"./chunk-GUZFMB3D.js";import"./chunk-N3C6FBKY.js";import"./chunk-CTKHELYY.js";import"./chunk-2L6X42XL.js";import"./chunk-2P4HZW3J.js";import"./chunk-OR3XQXDJ.js";import{d as O}from"./chunk-HLSJ3VIL.js";import{db as l,fa as x,m as r}from"./chunk-57EVB5FV.js";import{P as g,xa as v}from"./chunk-44HH5QGP.js";import"./chunk-WVRYN4MY.js";import"./chunk-2LSP5LV2.js";import{t as w}from"./chunk-HLWWEHZK.js";import"./chunk-5JGASDWN.js";import"./chunk-ZDPKBPMV.js";import"./chunk-DYQ7BPYX.js";import"./chunk-NMTPXQAP.js";import"./chunk-SIWEHH3L.js";import"./chunk-N6SSDFMX.js";import"./chunk-YJCG6GWC.js";import"./chunk-W7IWPUIQ.js";import"./chunk-4SCKDS7G.js";import"./chunk-DJGGVTSJ.js";import"./chunk-FATTDLFQ.js";import"./chunk-2RWUL32J.js";import"./chunk-RWWUDPHX.js";import{A as y,Ca as i,Z as T,a as b,b as S,z as u}from"./chunk-LQZGQEJ6.js";import"./chunk-FNC6PQ53.js";import"./chunk-5QQLABHI.js";import{a as t,g as s,i as d,n as f}from"./chunk-WKJYWAXG.js";d();f();var a=s(b(),1);var e=s(S(),1),P=r.div`
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  height: 100%;
  width: 100%;
  overflow-y: scroll;
  padding: 16px;
`,A=r.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  margin-top: -20px;
`,B=r(l).attrs({size:28,weight:500,color:i.colors.legacy.textBase})`
  margin-top: 24px;
`,M=r(l).attrs({size:16,weight:500,color:i.colors.legacy.textDiminished})`
  padding: 0px 5px;
  margin-top: 9px;
  span {
    color: ${i.colors.legacy.textBase};
  }
  label {
    color: ${i.colors.legacy.spotBase};
    cursor: pointer;
  }
`,F=r.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  height: fit-content;
`,L=r.div`
  margin-top: auto;
  width: 100%;
`,_=t(()=>{let{t:n}=T(),{mutateAsync:c}=C(),{handleHideModalVisibility:o,handleShowModalVisibility:m}=h(),k=(0,a.useCallback)(()=>{m("swapConfirmation",void 0,{event:"showSwapModal",payload:{data:{uiContext:g.SwapConfirmation}}}),o("swapTermsOfService")},[m,o]),p=v({goToConfirmation:k});return{onAgreeClick:(0,a.useCallback)(()=>{c(!0),p()},[c,p]),onCancelClick:t(()=>{o("swapTermsOfService")},"onCancelClick"),t:n}},"useSwapTermsOfServiceProps"),R=t(()=>{self.open(u,"_blank")},"handleTermsClick"),V=t(()=>{self.open(y,"_blank")},"handleFeesClick"),E=a.default.memo(({onAgreeClick:n,onCancelClick:c,t:o})=>(0,e.jsxs)(P,{children:[(0,e.jsx)(A,{children:(0,e.jsxs)(F,{children:[(0,e.jsx)(x,{}),(0,e.jsx)(B,{children:o("termsOfServicePrimaryText")}),(0,e.jsx)(M,{children:(0,e.jsxs)(w,{i18nKey:"termsOfServiceDiscliamerFeesEnabledInterpolated",children:["We have revised our Terms of Service. By clicking ",(0,e.jsx)("span",{children:'"I Agree"'})," you agree to our new",(0,e.jsx)("label",{onClick:R,children:"Terms of Service"}),".",(0,e.jsx)("br",{}),(0,e.jsx)("br",{}),"Our new Terms of Service include a new ",(0,e.jsx)("label",{onClick:V,children:"fee structure"})," for certain products."]})})]})}),(0,e.jsx)(L,{children:(0,e.jsx)(O,{primaryText:o("termsOfServiceActionButtonAgree"),secondaryText:o("commandCancel"),onPrimaryClicked:n,onSecondaryClicked:c})})]})),H=t(()=>{let n=_();return(0,e.jsx)(E,{...n})},"SwapTermsOfServicePage"),Z=H;export{H as SwapTermsOfServicePage,Z as default};
//# sourceMappingURL=SwapTermsOfServicePage-GDYA7WUR.js.map
