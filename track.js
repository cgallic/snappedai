// SNAP Analytics Tracker
(function() {
  const API = '/api/analytics';
  
  // Track page view on load
  function trackPageView() {
    fetch(API + '/pageview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        page: window.location.pathname,
        referrer: document.referrer,
        userAgent: navigator.userAgent
      })
    }).catch(() => {});
  }
  
  // Track custom events
  window.trackEvent = function(event, data) {
    fetch(API + '/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        page: window.location.pathname,
        data
      })
    }).catch(() => {});
  };
  
  // Auto-track on page load
  if (document.readyState === 'complete') {
    trackPageView();
  } else {
    window.addEventListener('load', trackPageView);
  }
  
  // Track tab/section clicks
  document.addEventListener('click', function(e) {
    const tab = e.target.closest('.tab');
    if (tab) {
      trackEvent('tab_click', { tab: tab.textContent.trim() });
    }
    
    const btn = e.target.closest('.btn, button');
    if (btn) {
      trackEvent('button_click', { button: btn.textContent.trim().substring(0, 50) });
    }
  });
})();
