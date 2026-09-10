Component({
  properties: {
    type: { type: String, value: 'empty' },
    title: { type: String, value: '' },
    description: { type: String, value: '' },
    actionText: { type: String, value: '' },
    compact: { type: Boolean, value: false }
  },

  methods: {
    handleAction: function () {
      this.triggerEvent('action');
    }
  }
});
