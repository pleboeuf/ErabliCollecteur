var devices = [
    {coreid:1f0042000447343337373738, name:"PL-Photon-A"},
    {coreid:55ff6e065075555351391787, name:"PL_Core1"},
    {coreid:42002a000847343339373536, name:"PL-Photon-B"},
    {coreid:2f0024000647343339373536, name:"PL-Photon-C"},
    {coreid:54ff6e066678574913440767, name:"JR1"},
    {coreid:54ff72066672524810390167, name:"JR2"} ];

console.log(devices);
console.log(devices.coreid55ff6e065075555351391787);

//
// // Define the Person constructor
// var Person = function(firstName) {
//     this.firstName = firstName;
// };
//
// // Add a couple of methods to Person.prototype
// Person.prototype.walk = function(){
//     console.log("I am walking!")
// };
//
// Person.prototype.sayHello = function(){
//     console.log("Hello, I am " + this.firstName);
// };
//
// // Define the Student constructor
// function Student (firstName, subject) {
//     // Call the parent constructor, making sure (using Function#call)
//      // that "this" is set correctly during the call
//      Person.call(this, firstName);
//
//      // Initialize our Student-specific properties
//      this.subject = subject;
// };
//
// // Create a Student.prototype object that inherits from Person.prototype.
// // Note: A common error here is to use "new Person()" to create the
// // Student.prototype. That's incorrect for several reasons, not least
// // that we don't have anything to give Person for the "firstName"
// // argument. The correct place to call Person is above, where we call
// // it from Student.
// Student.prototype = object.create(Person.prototype);
//
// // Set the "constructor" property to refer to Student
// Student.prototype.constructor = Student;
//
// // Replace the "sayHello" methods
// Student.prototype.sayHello = function(){
//     console.log("Hello I'm " + this.firstName + ". I'm studying " + this.subject + ".");
// };
//
// // Add a "sayGoodbye" method
// Student.prototype.sayGoodbye = function() {
//     console.log("Goodbye!");
// };
//
