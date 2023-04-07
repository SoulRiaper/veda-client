import Component, {html} from '../src/Component.js';
import TestSettingsComponent from './TestSettingsComponent.js';

customElements.define('test-settings', TestSettingsComponent);

export default class TestAppComponent extends Component(HTMLElement) {
  render () {
    return html`
      <style>
        a {color: red;}
      </style>
      <div>
        <h4>
          <a href="#/${this.model.id}">
            <span property="id"></span>
          </a>
        </h4>
        <strong about="d:TestSettings1" property="rdfs:label"></strong>
        <ul property="rdfs:label"><li></li></ul>
        <div rel="v-s:hasSettings">
          <test-settings></test-settings>
        </div>
      </div>
    `;
  }
}
