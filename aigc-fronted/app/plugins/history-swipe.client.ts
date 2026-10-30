import { installHistorySwipeGuard } from '~/lib/history-swipe'

export default defineNuxtPlugin({
  name: 'history-swipe-guard',
  enforce: 'pre',
  setup(nuxtApp) {
    const dispose = installHistorySwipeGuard(window)
    nuxtApp.vueApp.onUnmount(dispose)
    if (import.meta.hot) import.meta.hot.dispose(dispose)
  },
})
